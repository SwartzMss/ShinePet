/*
  ShinePet content script
  - 悬浮电子宠物
  - 拖拽并持久化位置（chrome.storage.sync）
  - 点击：挥手（轻度摇摆）
  - 双击：跳舞（高能摇摆，3 秒）
*/

(function initShinePet() {
  console.debug('[ShinePet] content v0.2.0 loaded');
  
  // 等待DOM完全加载
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initShinePet);
    return;
  }
  
  if (document.getElementById('shinepet-container')) {
    console.debug('[ShinePet] Container already exists, skipping');
    return;
  }

  console.debug('[ShinePet] Starting initialization...');

  // 全局显示状态
  let isPetVisible = true;

  const container = document.createElement('div');
  container.id = 'shinepet-container';
  container.setAttribute('aria-label', 'ShinePet');
  
  // 使用CSS类而不是内联样式来避免强制重排
  container.className = 'shinepet-main-container';
  
  // 只设置必要的定位样式 - 批量设置减少重排
  container.style.cssText = `
    position: fixed;
    bottom: 24px;
    right: 24px;
    z-index: 2147483647;
  `;

  // 内部包装，避免直接对 container 做 transform 影响定位
  const petWrapper = document.createElement('div');
  petWrapper.className = 'shinepet-wrapper shinepet-idle';

  const petImg = document.createElement('img');
  petImg.className = 'shinepet-img';
  petImg.alt = 'ShinePet';
  petImg.draggable = false;
  
  // 定义不同状态的动画资源
  const PET_ANIMATIONS = {
    idle: 'assets/mc_person_idle.svg',
    wave: ['assets/mc_person_wave_frame1.svg', 'assets/mc_person_wave_frame2.svg', 'assets/mc_person_wave_frame3.svg'],
    dance: 'assets/mc_person_dance.svg',
    walk: 'assets/mc_person_walk.svg',
    drag: 'assets/mc_person_drag.svg'
  };

  // 预加载所有动画帧以提升切换性能
  const preloadedImages = {};
  Object.entries(PET_ANIMATIONS).forEach(([key, pathOrPaths]) => {
    if (Array.isArray(pathOrPaths)) {
      // 多帧动画
      preloadedImages[key] = pathOrPaths.map(path => {
        const img = new Image();
        img.src = chrome.runtime.getURL(path);
        console.debug(`[ShinePet] Preloading ${key} frame:`, img.src);
        return img;
      });
    } else {
      // 单帧动画
      const img = new Image();
      img.src = chrome.runtime.getURL(pathOrPaths);
      preloadedImages[key] = img;
      console.debug(`[ShinePet] Preloading ${key} animation:`, img.src);
    }
  });
  
  // 设置初始状态为idle
  const skinUrl = chrome.runtime.getURL(PET_ANIMATIONS.idle);
  console.debug('[ShinePet] Loading image from:', skinUrl);
  
  // 简化的加载处理
  petImg.onload = () => {
    console.debug('[ShinePet] Image loaded successfully');
  };
  
  petImg.onerror = () => {
    console.error('[ShinePet] Image load failed');
  };
  
  petImg.src = skinUrl;

  // 动画切换函数
  let currentWaveFrame = 0;
  let waveFrameTimer = null;
  
  function switchAnimation(animationType) {
    const animationData = PET_ANIMATIONS[animationType];
    if (!animationData) return;
    
    if (Array.isArray(animationData)) {
      // 多帧动画 - 挥手动画
      if (animationType === 'wave') {
        startWaveAnimation();
      }
    } else {
      // 单帧动画
      petImg.src = chrome.runtime.getURL(animationData);
      console.debug(`[ShinePet] Switched to ${animationType} animation`);
    }
  }
  
  function startWaveAnimation() {
    const waveFrames = PET_ANIMATIONS.wave;
    currentWaveFrame = 0;
    
    function nextFrame() {
      if (currentWaveFrame < waveFrames.length) {
        petImg.src = chrome.runtime.getURL(waveFrames[currentWaveFrame]);
        console.debug(`[ShinePet] Wave frame ${currentWaveFrame + 1}/${waveFrames.length}`);
        currentWaveFrame++;
        
        // 每帧持续500ms
        if (currentWaveFrame < waveFrames.length) {
          waveFrameTimer = setTimeout(nextFrame, 500);
        } else {
          // 动画完成，最后一帧停留500ms后返回静止
          waveFrameTimer = setTimeout(() => {
            petImg.src = chrome.runtime.getURL(PET_ANIMATIONS.idle);
            waveFrameTimer = null;
          }, 500);
        }
      }
    }
    
    nextFrame();
  }
  
  function stopWaveAnimation() {
    if (waveFrameTimer) {
      clearTimeout(waveFrameTimer);
      waveFrameTimer = null;
    }
  }
  petWrapper.appendChild(petImg);

  // 将容器添加到页面
  container.appendChild(petWrapper);
  document.documentElement.appendChild(container);
  
  console.debug('[ShinePet] Container added to DOM, starting initialization...');

  // 确保容器准备就绪后再初始化
  setTimeout(() => {
    initVisibility();
  }, 100);
  console.debug('[ShinePet] Container added to DOM');
  console.debug('[ShinePet] Container position:', {
    bottom: container.style.bottom,
    right: container.style.right,
    opacity: getComputedStyle(container).opacity,
    display: getComputedStyle(container).display,
    zIndex: container.style.zIndex
  });

  // 持续监控容器状态，查看是否被页面样式影响
  const monitorContainer = () => {
    const rect = container.getBoundingClientRect();
    const computed = getComputedStyle(container);
    console.debug('[ShinePet] Container check:', {
      exists: !!document.getElementById('shinepet-container'),
      visible: computed.visibility,
      opacity: computed.opacity,
      display: computed.display,
      width: rect.width,
      height: rect.height,
      inViewport: rect.width > 0 && rect.height > 0
    });
  };
  
  // 立即检查一次，然后每2秒检查一次
  setTimeout(monitorContainer, 100);
  setTimeout(monitorContainer, 1000);
  setTimeout(monitorContainer, 3000);

  // 从存储恢复位置
  tryRestorePosition(container);

  // 拖拽逻辑
  const dragChecker = enableDrag(container);

  // 交互：单击循环切换动画，双击跳舞
  let danceTimer = null;
  let walkTimer = null;
  
  // 动画状态循环：idle -> wave -> walk -> idle
  const animationCycle = ['idle', 'wave'];
  let currentAnimationIndex = 0;
  
  // 走路移动功能
  function startWalkMovement(container) {
    const startTime = Date.now();
    const duration = 2000; // 2秒
    
    // 随机选择移动方向和距离
    const moveDistance = 50 + Math.random() * 100; // 50-150px
    const angle = Math.random() * 2 * Math.PI; // 随机角度
    const deltaX = Math.cos(angle) * moveDistance;
    const deltaY = Math.sin(angle) * moveDistance;
    
    // 获取当前位置
    const startRect = container.getBoundingClientRect();
    const startLeft = startRect.left;
    const startTop = startRect.top;
    
    // 计算目标位置，确保不超出屏幕边界
    const maxLeft = window.innerWidth - container.offsetWidth;
    const maxTop = window.innerHeight - container.offsetHeight;
    
    const targetLeft = Math.max(0, Math.min(maxLeft, startLeft + deltaX));
    const targetTop = Math.max(0, Math.min(maxTop, startTop + deltaY));
    
    function animateMovement() {
      const elapsed = Date.now() - startTime;
      const progress = Math.min(elapsed / duration, 1);
      
      // 使用easeInOut缓动函数
      const easedProgress = progress < 0.5 
        ? 2 * progress * progress 
        : 1 - Math.pow(-2 * progress + 2, 2) / 2;
      
      const currentLeft = startLeft + (targetLeft - startLeft) * easedProgress;
      const currentTop = startTop + (targetTop - startTop) * easedProgress;
      
      container.style.left = `${currentLeft}px`;
      container.style.top = `${currentTop}px`;
      container.style.right = '';
      container.style.bottom = '';
      
      if (progress < 1) {
        requestAnimationFrame(animateMovement);
      } else {
        // 移动完成后保存位置
        persistPosition(container);
      }
    }
    
    requestAnimationFrame(animateMovement);
  }
  
  // 跳跃移动功能（双击时调用）
  function startJumpMovement(container) {
    console.log('[ShinePet] Starting jump movement');
    
    // 获取当前位置
    const startRect = container.getBoundingClientRect();
    const startLeft = startRect.left;
    const startTop = startRect.top;
    
    // 随机选择跳跃方向：0=左右，1=上下
    const jumpType = Math.random() < 0.5 ? 'horizontal' : 'vertical';
    let jumpDistance = 80 + Math.random() * 40; // 80-120px的跳跃距离
    
    let targetLeft = startLeft;
    let targetTop = startTop;
    
    if (jumpType === 'horizontal') {
      // 左右跳跃：随机选择左或右
      const direction = Math.random() < 0.5 ? -1 : 1;
      targetLeft = startLeft + (direction * jumpDistance);
      
      // 确保不超出屏幕边界
      const maxLeft = window.innerWidth - container.offsetWidth;
      targetLeft = Math.max(0, Math.min(maxLeft, targetLeft));
      
      console.log('[ShinePet] Jump direction: horizontal', direction > 0 ? 'right' : 'left');
    } else {
      // 上下跳跃：随机选择上或下
      const direction = Math.random() < 0.5 ? -1 : 1;
      targetTop = startTop + (direction * jumpDistance);
      
      // 确保不超出屏幕边界
      const maxTop = window.innerHeight - container.offsetHeight;
      targetTop = Math.max(0, Math.min(maxTop, targetTop));
      
      console.log('[ShinePet] Jump direction: vertical', direction > 0 ? 'down' : 'up');
    }
    
    // 第一阶段：跳到目标位置（1.5秒）
    const phase1Duration = 1500;
    const phase1StartTime = Date.now();
    
    function animatePhase1() {
      const elapsed = Date.now() - phase1StartTime;
      const progress = Math.min(elapsed / phase1Duration, 1);
      
      // 使用弹跳缓动效果
      const easedProgress = progress < 0.5 
        ? 4 * progress * progress * progress
        : 1 - Math.pow(-2 * progress + 2, 3) / 2;
      
      const currentLeft = startLeft + (targetLeft - startLeft) * easedProgress;
      const currentTop = startTop + (targetTop - startTop) * easedProgress;
      
      container.style.left = `${currentLeft}px`;
      container.style.top = `${currentTop}px`;
      container.style.right = '';
      container.style.bottom = '';
      
      if (progress < 1) {
        requestAnimationFrame(animatePhase1);
      } else {
        // 第一阶段完成，开始第二阶段：返回原位置（1.5秒）
        setTimeout(startPhase2, 100); // 稍微停顿100ms
      }
    }
    
    function startPhase2() {
      const phase2Duration = 1500;
      const phase2StartTime = Date.now();
      
      // 记录当前位置作为第二阶段起点
      const phase2StartLeft = parseFloat(container.style.left);
      const phase2StartTop = parseFloat(container.style.top);
      
      function animatePhase2() {
        const elapsed = Date.now() - phase2StartTime;
        const progress = Math.min(elapsed / phase2Duration, 1);
        
        // 使用相同的弹跳缓动效果
        const easedProgress = progress < 0.5 
          ? 4 * progress * progress * progress
          : 1 - Math.pow(-2 * progress + 2, 3) / 2;
        
        const currentLeft = phase2StartLeft + (startLeft - phase2StartLeft) * easedProgress;
        const currentTop = phase2StartTop + (startTop - phase2StartTop) * easedProgress;
        
        container.style.left = `${currentLeft}px`;
        container.style.top = `${currentTop}px`;
        
        if (progress < 1) {
          requestAnimationFrame(animatePhase2);
        } else {
          // 跳跃完成，保存最终位置
          console.log('[ShinePet] Jump movement completed, returned to start position');
          persistPosition(container);
        }
      }
      
      requestAnimationFrame(animatePhase2);
    }
    
    requestAnimationFrame(animatePhase1);
  }
  
  container.addEventListener('click', (e) => {
    e.stopPropagation();
    
    // 检查是否刚刚完成拖动，如果是则忽略点击
    if (dragChecker.hasDragged()) {
      console.log('[ShinePet] Ignoring click after drag');
      return;
    }
    
    // 如果正在跳舞，忽略单击
    if (danceTimer) return;
    
    console.log('[ShinePet] Processing click event');
    
    // 清除可能存在的定时器
    if (walkTimer) {
      clearTimeout(walkTimer);
      walkTimer = null;
    }
    
    // 停止挥手动画
    stopWaveAnimation();
    
    // 简化逻辑：只在静止和挥手之间切换
    if (currentAnimationIndex === 0) {
      // 当前是静止状态，切换到挥手
      currentAnimationIndex = 1;
      petWrapper.classList.remove('shinepet-idle', 'shinepet-walk', 'shinepet-dance');
      petWrapper.classList.add('shinepet-wave');
      switchAnimation('wave');
    } else {
      // 当前是挥手状态，回到静止
      currentAnimationIndex = 0;
      petWrapper.classList.remove('shinepet-wave', 'shinepet-walk', 'shinepet-dance');
      petWrapper.classList.add('shinepet-idle');
      switchAnimation('idle');
    }
  }, true);

  container.addEventListener('dblclick', (e) => {
    // 双击：触发走路，包含随机方向移动
    e.stopPropagation();
    
    // 检查是否刚刚完成拖动，如果是则忽略双击
    if (dragChecker.hasDragged()) {
      console.log('[ShinePet] Ignoring dblclick after drag');
      return;
    }
    
    console.log('[ShinePet] Processing dblclick event');
    
    // 清除所有定时器
    if (danceTimer) {
      clearTimeout(danceTimer);
      danceTimer = null;
    }
    if (walkTimer) {
      clearTimeout(walkTimer);
      walkTimer = null;
    }
    
    // 停止挥手动画
    stopWaveAnimation();
    
    // 切换到走路动画并开始移动
    petWrapper.classList.remove('shinepet-idle', 'shinepet-wave', 'shinepet-dance');
    petWrapper.classList.add('shinepet-walk');
    switchAnimation('walk');
    
    // 开始走路移动（复用跳跃的移动逻辑）
    startJumpMovement(container);
    
    walkTimer = setTimeout(() => {
      petWrapper.classList.remove('shinepet-walk');
      petWrapper.classList.add('shinepet-idle');
      switchAnimation('idle');
      // 走路结束后重置为静止状态
      currentAnimationIndex = 0;
      walkTimer = null;
    }, 3000);
  }, true);

  // 随机漫步功能（供自动行为使用）
  function startRandomWalk() {
    if (walkTimer || danceTimer) return;
    
    petWrapper.classList.remove('shinepet-idle', 'shinepet-wave');
    petWrapper.classList.add('shinepet-walk');
    switchAnimation('walk');
    
    // 启动移动动画
    startWalkMovement(container);
    
    walkTimer = setTimeout(() => {
      petWrapper.classList.remove('shinepet-walk');
      petWrapper.classList.add('shinepet-idle');
      switchAnimation('idle');
      // 随机行为结束后也重置状态，避免干扰用户点击循环
      currentAnimationIndex = 0;
      walkTimer = null;
    }, 2000);
  }

  // 定时随机动作（可选）
  let randomActionTimer = setInterval(() => {
    // 5% 概率随机执行动作
    if (Math.random() < 0.05 && !walkTimer && !danceTimer) {
      const actions = ['wave', 'walk'];
      const randomAction = actions[Math.floor(Math.random() * actions.length)];
      
      if (randomAction === 'walk') {
        startRandomWalk();
      } else if (randomAction === 'wave') {
        petWrapper.classList.remove('shinepet-idle');
        petWrapper.classList.add('shinepet-wave');
        switchAnimation('wave');
        setTimeout(() => {
          stopWaveAnimation();
          petWrapper.classList.remove('shinepet-wave');
          petWrapper.classList.add('shinepet-idle');
          switchAnimation('idle');
          // 随机行为结束后重置状态
          currentAnimationIndex = 0;
        }, 2000); // 2秒足够完成一次完整的挥手动画 (3帧 × 500ms + 最后停留500ms)
      }
    }
  }, 15000); // 每15秒检查一次

  // ===== 天气展示与右键菜单 =====
  const WEATHER_STORAGE_KEY = 'shinepetWeather';
  const SETTINGS_STORAGE_KEY = 'shinepetSettings';
  let weatherEnabled = true;
  let weatherTimer = null;

  // 天气气泡
  const weatherBadge = document.createElement('div');
  weatherBadge.className = 'shinepet-weather';
  weatherBadge.style.display = 'none';
  petWrapper.appendChild(weatherBadge);

  // 右键：自定义菜单（打开设置）
  const contextMenu = createContextMenu();
  document.body.appendChild(contextMenu);
  container.addEventListener('contextmenu', (e) => {
    e.preventDefault();
    openContextMenuAt(e.clientX, e.clientY);
  });
  window.addEventListener('click', () => hideContextMenu());

  // 初始化：恢复设置与天气缓存
  restoreSettingsAndWeather().then(() => {
    // 首次展示或按需刷新
    ensureWeatherFreshness();
    // 每 2 小时定时刷新（仅页面打开期间有效）
    if (weatherTimer) clearInterval(weatherTimer);
    weatherTimer = setInterval(() => {
      if (!weatherEnabled) return;
      refreshWeather();
    }, 2 * 60 * 60 * 1000);
  });

  function tryRestorePosition(target) {
    try {
      chrome.storage.sync.get(['shinepetPosition'], (res) => {
        const pos = res && res.shinepetPosition;
        if (!pos || typeof pos.left !== 'number' || typeof pos.top !== 'number') return;
        // 采用 left/top 绝对定位
        target.style.bottom = '';
        target.style.right = '';
        target.style.left = `${pos.left}px`;
        target.style.top = `${pos.top}px`;
      });
    } catch (_) {
      // 在不支持 storage 的环境下静默
    }
  }

  function enableDrag(target) {
    let isDragging = false;
    let hasDragged = false; // 新增：跟踪是否真的发生了拖动
    let startX = 0;
    let startY = 0;
    let startLeft = 0;
    let startTop = 0;
    const dragThreshold = 5; // 拖动阈值：移动超过5px才算拖动

    const onPointerDown = (e) => {
      if (e.button !== 0 && e.pointerType !== 'touch') return;
      isDragging = true;
      hasDragged = false; // 重置拖动状态
      startX = e.clientX;
      startY = e.clientY;
      const rect = target.getBoundingClientRect();
      startLeft = rect.left;
      startTop = rect.top;
      target.style.cursor = 'grabbing';
      target.setPointerCapture?.(e.pointerId);
      e.preventDefault();
      
      console.log('[ShinePet] Drag started');
    };

    const onPointerMove = (e) => {
      if (!isDragging) return;
      const dx = e.clientX - startX;
      const dy = e.clientY - startY;
      
      // 检查是否超过拖动阈值
      if (!hasDragged && (Math.abs(dx) > dragThreshold || Math.abs(dy) > dragThreshold)) {
        hasDragged = true;
        // 开始拖动时切换到拖动动画
        console.log('[ShinePet] Drag threshold exceeded, switching to drag animation');
        switchAnimation('drag');
      }
      
      if (hasDragged) {
        const nextLeft = Math.max(0, Math.min(window.innerWidth - target.offsetWidth, startLeft + dx));
        const nextTop = Math.max(0, Math.min(window.innerHeight - target.offsetHeight, startTop + dy));
        // 使用 transform 代替 left/top 避免重排
        target.style.transform = `translate(${nextLeft - startLeft}px, ${nextTop - startTop}px)`;
      }
    };

    const onPointerUp = (e) => {
      if (!isDragging) return;
      isDragging = false;
      target.style.cursor = 'grab';
      target.releasePointerCapture?.(e.pointerId);
      
      // 只有真正拖动了才处理位置更新
      if (hasDragged) {
        console.log('[ShinePet] Drag ended, returning to idle animation');
        
        // 将transform转换为实际位置
        const transform = target.style.transform;
        if (transform && transform.includes('translate')) {
          const rect = target.getBoundingClientRect();
          target.style.left = `${rect.left}px`;
          target.style.top = `${rect.top}px`;
          target.style.right = '';
          target.style.bottom = '';
          target.style.transform = '';
        }
        
        persistPosition(target);
        
        // 拖动结束后返回静止状态
        switchAnimation('idle');
        
        // 延迟重置拖动状态，避免立即触发点击事件
        setTimeout(() => {
          hasDragged = false;
        }, 100);
      } else {
        // 没有拖动，立即重置状态
        hasDragged = false;
      }
    };

    target.addEventListener('pointerdown', onPointerDown);
    window.addEventListener('pointermove', onPointerMove);
    window.addEventListener('pointerup', onPointerUp);
    
    // 返回检查函数，供点击事件使用
    return {
      isDragging: () => isDragging,
      hasDragged: () => hasDragged
    };
  }

  function persistPosition(target) {
    const rect = target.getBoundingClientRect();
    const data = { left: Math.round(rect.left), top: Math.round(rect.top) };
    try {
      chrome.storage.sync.set({ shinepetPosition: data });
    } catch (_) {
      // 忽略
    }
  }

  // ====== 天气实现 ======

  function showToast(text) {
    const toast = document.createElement('div');
    toast.className = 'shinepet-toast';
    toast.textContent = text;
    document.body.appendChild(toast);
    // 使用setTimeout代替requestAnimationFrame
    setTimeout(() => toast.classList.add('visible'), 10);
    setTimeout(() => {
      toast.classList.remove('visible');
      setTimeout(() => toast.remove(), 300);
    }, 2000);
  }

  async function restoreSettingsAndWeather() {
    const res = await chromeStorageGet([SETTINGS_STORAGE_KEY, WEATHER_STORAGE_KEY]);
    const settings = res && res[SETTINGS_STORAGE_KEY] ? res[SETTINGS_STORAGE_KEY] : {};
    const weather = res && res[WEATHER_STORAGE_KEY] ? res[WEATHER_STORAGE_KEY] : null;
    if (settings && typeof settings.weatherEnabled === 'boolean') {
      weatherEnabled = settings.weatherEnabled;
    }
    if (weatherEnabled) {
      weatherBadge.style.display = '';
    }
    if (weather && weather.data && typeof weather.timestamp === 'number') {
      renderWeather(weather.data);
    }
  }

  function ensureWeatherFreshness() {
    chromeStorageGet([WEATHER_STORAGE_KEY]).then((res) => {
      try {
        const cache = res && res[WEATHER_STORAGE_KEY];
        const now = Date.now();
        if (!cache || now - (cache.timestamp || 0) > 2 * 60 * 60 * 1000) {
          refreshWeather();
        }
      } catch (_) {
        // 忽略
      }
    });
  }

  async function refreshWeather(force = false) {
    if (!weatherEnabled && !force) return;
    // 1) 拿到坐标优先级：设置的坐标 > 定位 > 失败
    const settingsRes = await chromeStorageGet([SETTINGS_STORAGE_KEY]);
    const settings = (settingsRes && settingsRes[SETTINGS_STORAGE_KEY]) || {};
    let coords = settings.coords;
    if (!coords) {
      coords = await getGeolocation();
      if (coords) await persistSettings({ coords });
    }
    if (!coords) {
      showToast('缺少位置：右键设置城市或开启定位');
      return;
    }
    const data = await fetchWeather(coords.lat, coords.lon);
    if (data) {
      renderWeather(data);
      await chromeStorageSet({ [WEATHER_STORAGE_KEY]: { timestamp: Date.now(), data } });
    }
  }

  function renderWeather(data) {
    if (!weatherEnabled) return;
    const text = formatWeatherText(data);
    weatherBadge.textContent = text;
    weatherBadge.style.display = '';
  }

  function formatWeatherText(data = {}) {
    // 期望数据：{ temperature, weatherCode, isDay, windSpeed }
    const emoji = emojiFromWeatherCode(data.weatherCode, data.isDay);
    const temp = typeof data.temperature === 'number' ? `${Math.round(data.temperature)}°C` : '';
    return `${emoji} ${temp}`.trim();
  }

  function emojiFromWeatherCode(code, isDay) {
    // 简易映射（Open-Meteo weather_code）
    // 0: Clear sky, 1-3: Mainly clear/partly cloudy/overcast
    if (code === 0) return isDay ? '☀️' : '🌙';
    if (code >= 1 && code <= 3) return '⛅';
    if (code === 45 || code === 48) return '🌫️';
    if (code >= 51 && code <= 57) return '🌦️';
    if (code >= 61 && code <= 67) return '🌧️';
    if (code >= 71 && code <= 77) return '❄️';
    if (code >= 80 && code <= 82) return '🌧️';
    if (code >= 85 && code <= 86) return '❄️';
    if (code >= 95 && code <= 99) return '⛈️';
    return '🌤️';
  }

  async function fetchWeather(lat, lon) {
    try {
      const url = new URL('https://api.open-meteo.com/v1/forecast');
      url.searchParams.set('latitude', String(lat));
      url.searchParams.set('longitude', String(lon));
      url.searchParams.set('current', 'temperature_2m,is_day,weather_code,wind_speed_10m');
      url.searchParams.set('timezone', 'auto');
      const resp = await fetch(url.toString());
      if (!resp.ok) throw new Error('weather http ' + resp.status);
      const json = await resp.json();
      const c = json && json.current;
      if (!c) return null;
      return {
        temperature: c.temperature_2m,
        isDay: Boolean(c.is_day),
        weatherCode: c.weather_code,
        windSpeed: c.wind_speed_10m,
      };
    } catch (e) {
      showToast('获取天气失败');
      return null;
    }
  }

  async function geocodeCity(name) {
    try {
      const url = new URL('https://geocoding-api.open-meteo.com/v1/search');
      url.searchParams.set('name', name);
      url.searchParams.set('count', '1');
      url.searchParams.set('language', 'zh');
      url.searchParams.set('format', 'json');
      const resp = await fetch(url.toString());
      if (!resp.ok) throw new Error('geo http ' + resp.status);
      const json = await resp.json();
      const r = json && Array.isArray(json.results) ? json.results[0] : null;
      if (!r) return null;
      return { lat: r.latitude, lon: r.longitude };
    } catch (_) {
      return null;
    }
  }

  async function getGeolocation() {
    if (!('geolocation' in navigator)) return null;
    try {
      const pos = await new Promise((resolve, reject) => {
        navigator.geolocation.getCurrentPosition(resolve, reject, {
          enableHighAccuracy: false,
          timeout: 10000,
          maximumAge: 24 * 60 * 60 * 1000,
        });
      });
      return { lat: pos.coords.latitude, lon: pos.coords.longitude };
    } catch (_) {
      return null;
    }
  }

  function chromeStorageGet(keys) {
    return new Promise((resolve) => {
      try {
        chrome.storage.sync.get(keys, (res) => resolve(res || {}));
      } catch (_) {
        resolve({});
      }
    });
  }
  function chromeStorageSet(obj) {
    return new Promise((resolve) => {
      try {
        chrome.storage.sync.set(obj, () => resolve());
      } catch (_) {
        resolve();
      }
    });
  }
  async function persistSettings(partial = {}) {
    const currentRes = await chromeStorageGet([SETTINGS_STORAGE_KEY]);
    const current = (currentRes && currentRes[SETTINGS_STORAGE_KEY]) || {};
    const next = { ...current, weatherEnabled, ...partial };
    await chromeStorageSet({ [SETTINGS_STORAGE_KEY]: next });
  }

  // ====== 右键菜单实现 ======
  function createContextMenu() {
    const menu = document.createElement('div');
    menu.className = 'shinepet-context-menu';
    menu.style.display = 'none';

    const btnOptions = document.createElement('button');
    btnOptions.className = 'shinepet-menu-item';
    btnOptions.textContent = '打开设置';
    btnOptions.addEventListener('click', () => {
      hideContextMenu();
      // 发送消息给background script打开设置页面
      chrome.runtime.sendMessage({ action: 'openOptions' });
    });

    menu.appendChild(btnOptions);
    return menu;
  }

  function openContextMenuAt(x, y) {
    contextMenu.style.left = `${x}px`;
    contextMenu.style.top = `${y}px`;
    contextMenu.style.display = 'flex';
  }
  function hideContextMenu() {
    contextMenu.style.display = 'none';
  }

  // 显示/隐藏功能
  function showPet() {
    console.log('[ShinePet] showPet called, container:', container);
    if (container) {
      container.style.display = 'block';
      container.style.visibility = 'visible';
      container.style.opacity = '1';
      isPetVisible = true;
      console.debug('[ShinePet] Pet shown successfully - display:', container.style.display);
    } else {
      console.error('[ShinePet] Container not found in showPet');
    }
  }

  function hidePet() {
    console.log('[ShinePet] hidePet called, container:', container);
    if (container) {
      container.style.display = 'none';
      container.style.visibility = 'hidden';
      container.style.opacity = '0';
      isPetVisible = false;
      console.debug('[ShinePet] Pet hidden successfully - display:', container.style.display);
    } else {
      console.error('[ShinePet] Container not found in hidePet');
    }
  }

  function togglePetVisibility(visible) {
    console.log('[ShinePet] togglePetVisibility called with:', visible, 'current isPetVisible:', isPetVisible);
    if (visible === undefined) {
      visible = !isPetVisible;
    }
    
    if (visible) {
      showPet();
    } else {
      hidePet();
    }
  }

  // 初始化时检查显示状态
  async function initVisibility() {
    try {
      // 先检查storage中的状态
      const result = await new Promise(resolve => {
        chrome.storage.sync.get(['petVisible'], resolve);
      });
      
      const shouldShow = result.petVisible !== false; // 默认显示
      togglePetVisibility(shouldShow);
      
      // 向background script确认状态
      chrome.runtime.sendMessage(
        { action: 'getPetVisibility' },
        (response) => {
          if (response && response.visible !== undefined) {
            togglePetVisibility(response.visible);
          }
        }
      );
    } catch (error) {
      console.debug('[ShinePet] Could not check initial visibility, defaulting to visible');
      showPet();
    }
  }

  // 监听来自background script的消息
  chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    console.log('[ShinePet] Received message:', message);
    
    try {
      if (message.action === 'togglePetVisibility') {
        console.log('[ShinePet] Processing togglePetVisibility message, visible:', message.visible);
        togglePetVisibility(message.visible);
        sendResponse({ success: true });
        return true; // 保持消息通道开放
      }
    } catch (error) {
      console.error('[ShinePet] Error processing message:', error);
      sendResponse({ success: false, error: error.message });
    }
    
    return false; // 对于其他消息，不保持通道开放
  });

})();
