/*
  ShinePet content script
  - 悬浮电子宠物
  - 拖拽并持久化位置（chrome.storage.sync）
  - 点击：挥手（轻度摇摆）
  - 双击：跳舞（高能摇摆，3 秒）
*/

(function initShinePet() {
  try { console.debug('[ShinePet] content v0.1.2 loaded'); } catch (_) {}
  if (document.getElementById('shinepet-container')) return;

  const container = document.createElement('div');
  container.id = 'shinepet-container';
  container.setAttribute('aria-label', 'ShinePet');
  container.style.position = 'fixed';
  container.style.bottom = '24px';
  container.style.right = '24px';
  container.style.zIndex = '2147483647';
  container.style.width = '96px';
  container.style.height = '96px';
  container.style.cursor = 'grab';
  container.style.userSelect = 'none';
  container.style.touchAction = 'none';

  // 内部包装，避免直接对 container 做 transform 影响定位
  const petWrapper = document.createElement('div');
  petWrapper.className = 'shinepet-wrapper shinepet-idle';
  petWrapper.style.width = '100%';
  petWrapper.style.height = '100%';

  const petImg = document.createElement('img');
  petImg.className = 'shinepet-img';
  petImg.alt = 'ShinePet';
  petImg.draggable = false;
  // 优先尝试像素人皮肤，不存在则回退到默认 pet.svg
  const primarySkinUrl = chrome.runtime.getURL('assets/mc_person.svg');
  const fallbackUrl = chrome.runtime.getURL('assets/pet.svg');
  petImg.src = primarySkinUrl;
  petImg.onerror = () => {
    if (petImg.src !== fallbackUrl) {
      petImg.src = fallbackUrl;
    }
  };
  petWrapper.appendChild(petImg);

  container.appendChild(petWrapper);
  document.documentElement.appendChild(container);

  // ===== 足球小游戏 =====
  let soccerOverlay = null;
  let soccerCanvas = null;
  let soccerCtx = null;
  let soccerState = null;

  // 从存储恢复位置
  tryRestorePosition(container);

  // 拖拽逻辑
  enableDrag(container);

  // 交互：点击挥手、双击跳舞
  let danceTimer = null;
  container.addEventListener('click', (e) => {
    // 单击：切换挥手动画
    e.stopPropagation();
    const isWaving = petWrapper.classList.contains('shinepet-wave');
    petWrapper.classList.remove('shinepet-dance');
    if (isWaving) {
      petWrapper.classList.remove('shinepet-wave');
      petWrapper.classList.add('shinepet-idle');
    } else {
      petWrapper.classList.remove('shinepet-idle');
      petWrapper.classList.add('shinepet-wave');
    }
  }, true);

  container.addEventListener('dblclick', (e) => {
    // 双击：触发 3 秒跳舞
    e.stopPropagation();
    if (danceTimer) {
      clearTimeout(danceTimer);
      danceTimer = null;
    }
    petWrapper.classList.remove('shinepet-idle', 'shinepet-wave');
    petWrapper.classList.add('shinepet-dance');
    danceTimer = setTimeout(() => {
      petWrapper.classList.remove('shinepet-dance');
      petWrapper.classList.add('shinepet-idle');
      danceTimer = null;
    }, 3000);
  }, true);

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

  // 右键：自定义菜单（足球游戏 / 打开设置）
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
    let startX = 0;
    let startY = 0;
    let startLeft = 0;
    let startTop = 0;

    const onPointerDown = (e) => {
      if (e.button !== 0 && e.pointerType !== 'touch') return;
      isDragging = true;
      startX = e.clientX;
      startY = e.clientY;
      const rect = target.getBoundingClientRect();
      startLeft = rect.left;
      startTop = rect.top;
      target.style.cursor = 'grabbing';
      target.setPointerCapture?.(e.pointerId);
      e.preventDefault();
    };

    const onPointerMove = (e) => {
      if (!isDragging) return;
      const dx = e.clientX - startX;
      const dy = e.clientY - startY;
      const nextLeft = Math.max(0, Math.min(window.innerWidth - target.offsetWidth, startLeft + dx));
      const nextTop = Math.max(0, Math.min(window.innerHeight - target.offsetHeight, startTop + dy));
      target.style.left = `${nextLeft}px`;
      target.style.top = `${nextTop}px`;
      target.style.right = '';
      target.style.bottom = '';
    };

    const onPointerUp = (e) => {
      if (!isDragging) return;
      isDragging = false;
      target.style.cursor = 'grab';
      target.releasePointerCapture?.(e.pointerId);
      persistPosition(target);
    };

    target.addEventListener('pointerdown', onPointerDown);
    window.addEventListener('pointermove', onPointerMove);
    window.addEventListener('pointerup', onPointerUp);
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
    requestAnimationFrame(() => toast.classList.add('visible'));
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

  // ====== 足球小游戏实现 ======
  function createContextMenu() {
    const menu = document.createElement('div');
    menu.className = 'shinepet-context-menu';
    menu.style.display = 'none';

    const btnSoccer = document.createElement('button');
    btnSoccer.className = 'shinepet-menu-item';
    btnSoccer.textContent = '开启足球游戏';
    btnSoccer.addEventListener('click', () => {
      hideContextMenu();
      toggleSoccer();
      updateSoccerBtn();
    });

    const btnOptions = document.createElement('button');
    btnOptions.className = 'shinepet-menu-item';
    btnOptions.textContent = '打开设置';
    btnOptions.addEventListener('click', () => {
      hideContextMenu();
      try { chrome.runtime.openOptionsPage?.(); } catch (_) {}
    });

    menu.appendChild(btnSoccer);
    menu.appendChild(btnOptions);

    function updateSoccerBtn() {
      const active = !!(soccerOverlay && soccerOverlay.classList.contains('active'));
      btnSoccer.textContent = active ? '关闭足球游戏' : '开启足球游戏';
    }
    menu.updateSoccerBtn = updateSoccerBtn;
    return menu;
  }

  function openContextMenuAt(x, y) {
    contextMenu.style.left = `${x}px`;
    contextMenu.style.top = `${y}px`;
    contextMenu.style.display = 'flex';
    contextMenu.updateSoccerBtn?.();
  }
  function hideContextMenu() {
    contextMenu.style.display = 'none';
  }
  function toggleSoccer() {
    if (!soccerOverlay) initSoccer();
    const active = soccerOverlay.classList.toggle('active');
    if (active) resetSoccer();
    contextMenu.updateSoccerBtn?.();
  }

  function initSoccer() {
    soccerOverlay = document.createElement('div');
    soccerOverlay.id = 'shinepet-soccer-overlay';
    soccerCanvas = document.createElement('canvas');
    soccerCanvas.id = 'shinepet-soccer-canvas';
    soccerOverlay.appendChild(soccerCanvas);

    const panel = document.createElement('div');
    panel.className = 'shinepet-soccer-panel';
    panel.innerHTML = `
      <div class="shinepet-soccer-row"><strong>足球小游戏</strong></div>
      <div class="shinepet-soccer-row"><label>球门</label><input id="sp-goal" type="range" min="60" max="300" value="160" /></div>
      <div class="shinepet-soccer-row"><label>力度</label><input id="sp-power" type="range" min="10" max="100" value="60" /></div>
      <div class="shinepet-soccer-row"><label>角度</label><input id="sp-angle" type="range" min="10" max="80" value="40" /></div>
      <div class="shinepet-soccer-actions">
        <button id="sp-start" class="shinepet-btn primary">开始</button>
        <button id="sp-reset" class="shinepet-btn">重置</button>
        <button id="sp-close" class="shinepet-btn">关闭(Alt+S)</button>
      </div>
      <div class="shinepet-hint">提示：拖动滑块可预览轨迹；点击“开始”射门。</div>
    `;
    soccerOverlay.appendChild(panel);

    document.documentElement.appendChild(soccerOverlay);
    soccerCtx = soccerCanvas.getContext('2d');
    window.addEventListener('resize', resizeSoccerCanvas);
    resizeSoccerCanvas();

    // 控件
    const el = (id) => panel.querySelector('#' + id);
    const goalRange = el('sp-goal');
    const powerRange = el('sp-power');
    const angleRange = el('sp-angle');
    const startBtn = el('sp-start');
    const resetBtn = el('sp-reset');
    const closeBtn = el('sp-close');

    const updatePreview = () => {
      if (!soccerState || !soccerState.idle) return;
      renderSoccer(true);
    };
    goalRange.addEventListener('input', updatePreview);
    powerRange.addEventListener('input', updatePreview);
    angleRange.addEventListener('input', updatePreview);
    startBtn.addEventListener('click', shootBall);
    resetBtn.addEventListener('click', resetSoccer);
    closeBtn.addEventListener('click', toggleSoccer);
  }

  function resizeSoccerCanvas() {
    soccerCanvas.width = window.innerWidth;
    soccerCanvas.height = window.innerHeight;
    if (soccerState) renderSoccer(true);
  }

  function resetSoccer() {
    const panel = soccerOverlay.querySelector('.shinepet-soccer-panel');
    const goal = Number(panel.querySelector('#sp-goal').value);
    soccerState = {
      idle: true,
      t: 0,
      // 球门位于画面右侧中部的矩形开口
      goalWidth: goal,
      ball: { x: 120, y: soccerCanvas.height - 80, r: 10 },
      groundY: soccerCanvas.height - 60,
      gravity: 980, // px/s^2（计算时会做缩放）
      vx: 0,
      vy: 0,
      path: [],
    };
    renderSoccer(true);
  }

  function shootBall() {
    if (!soccerState || !soccerState.idle) return;
    const panel = soccerOverlay.querySelector('.shinepet-soccer-panel');
    const power = Number(panel.querySelector('#sp-power').value); // 10-100
    const angleDeg = Number(panel.querySelector('#sp-angle').value); // 10-80
    const angle = (angleDeg * Math.PI) / 180;
    const v0 = power * 10; // 初速度缩放

    soccerState.idle = false;
    soccerState.t = 0;
    soccerState.vx = v0 * Math.cos(angle);
    soccerState.vy = -v0 * Math.sin(angle);
    soccerState.path = [];
    requestAnimationFrame(stepSoccer);
  }

  function stepSoccer(ts) {
    if (!soccerState.prevTs) soccerState.prevTs = ts;
    const dt = Math.min(0.032, (ts - soccerState.prevTs) / 1000);
    soccerState.prevTs = ts;

    const s = soccerState;
    s.t += dt;
    // 基本抛体：x = v0x * t, y = v0y * t + 0.5 * g * t^2
    s.ball.x += s.vx * dt;
    s.ball.y += s.vy * dt + 0.5 * (s.gravity * 0.12) * dt * dt;
    s.vy += (s.gravity * 0.12) * dt;
    s.path.push({ x: s.ball.x, y: s.ball.y });

    // 碰地停止
    if (s.ball.y + s.ball.r >= s.groundY) {
      s.ball.y = s.groundY - s.ball.r;
      finishSoccer();
      return;
    }

    renderSoccer(false);
    requestAnimationFrame(stepSoccer);
  }

  function finishSoccer() {
    const scored = checkGoal();
    showToast(scored ? '进球！⚽️' : '没进，再试一次');
    soccerState.idle = true;
    renderSoccer(true);
  }

  function checkGoal() {
    const s = soccerState;
    // 球门区域：右侧一段开口
    const goalW = s.goalWidth;
    const goalLeft = soccerCanvas.width - goalW - 40;
    const goalRight = soccerCanvas.width - 40;
    const goalTop = s.groundY - 120;
    const goalBottom = s.groundY;
    const b = s.ball;
    return b.x + b.r >= goalLeft && b.x - b.r <= goalRight && b.y + b.r >= goalTop && b.y <= goalBottom;
  }

  function renderSoccer(previewOnly) {
    const s = soccerState;
    const ctx = soccerCtx;
    const w = soccerCanvas.width;
    const h = soccerCanvas.height;
    const panel = soccerOverlay.querySelector('.shinepet-soccer-panel');
    const power = Number(panel.querySelector('#sp-power').value);
    const angle = Number(panel.querySelector('#sp-angle').value);
    const goalW = Number(panel.querySelector('#sp-goal').value);

    ctx.clearRect(0, 0, w, h);

    // 背景和地面
    ctx.fillStyle = '#0b1220';
    ctx.fillRect(0, 0, w, h);
    ctx.fillStyle = '#064e3b';
    ctx.fillRect(0, s.groundY, w, h - s.groundY);

    // 球门
    const goalLeft = w - goalW - 40;
    ctx.strokeStyle = '#e5e7eb';
    ctx.lineWidth = 6;
    ctx.strokeRect(goalLeft, s.groundY - 120, goalW, 120);

    // 轨迹预览（基于当前滑块）
    if (s.idle) {
      const angleRad = (angle * Math.PI) / 180;
      const v0 = power * 10;
      let x = 120;
      let y = s.groundY - 80;
      let vx = v0 * Math.cos(angleRad);
      let vy = -v0 * Math.sin(angleRad);
      ctx.strokeStyle = 'rgba(255,255,255,.5)';
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(x, y);
      for (let i = 0; i < 120; i++) {
        x += vx * 0.016;
        y += vy * 0.016 + 0.5 * (s.gravity * 0.12) * 0.016 * 0.016;
        vy += (s.gravity * 0.12) * 0.016;
        ctx.lineTo(x, y);
        if (y >= s.groundY) break;
      }
      ctx.stroke();
    }

    // 真实飞行轨迹
    if (s.path.length > 1) {
      ctx.strokeStyle = '#22d3ee';
      ctx.lineWidth = 3;
      ctx.beginPath();
      ctx.moveTo(s.path[0].x, s.path[0].y);
      for (let i = 1; i < s.path.length; i++) ctx.lineTo(s.path[i].x, s.path[i].y);
      ctx.stroke();
    }

    // 球
    ctx.fillStyle = '#f9fafb';
    ctx.beginPath();
    ctx.arc(s.ball.x, s.ball.y, s.ball.r, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = '#111827';
    ctx.stroke();
  }
})();


