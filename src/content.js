/*
  ShinePet content script
  - 悬浮电子宠物
  - 拖拽并持久化位置（chrome.storage.sync）
  - 点击：挥手（轻度摇摆）
  - 双击：跳舞（高能摇摆，3 秒）
*/

(function initShinePet() {
  try { console.debug('[ShinePet] content v0.2.0 loaded'); } catch (_) {}
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
  
  // 添加加载完成处理，防止闪烁
  petImg.onload = () => {
    container.classList.add('loaded');
  };
  
  petImg.src = primarySkinUrl;
  petImg.onerror = () => {
    if (petImg.src !== fallbackUrl) {
      petImg.src = fallbackUrl;
      // 确保fallback图片加载完成后也显示
      petImg.onload = () => {
        container.classList.add('loaded');
      };
    }
  };
  petWrapper.appendChild(petImg);

  container.appendChild(petWrapper);
  document.documentElement.appendChild(container);

  // 添加备用显示逻辑，防止图片加载事件失效
  setTimeout(() => {
    if (!container.classList.contains('loaded')) {
      container.classList.add('loaded');
    }
  }, 500);

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
      try { chrome.runtime.openOptionsPage?.(); } catch (_) {}
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
})();
