(function initOptions() {
  const WEATHER_STORAGE_KEY = 'shinepetWeather';
  const SETTINGS_STORAGE_KEY = 'shinepetSettings';

  const $ = (id) => document.getElementById(id);
  const weatherEnabledEl = $('weatherEnabled');
  const useGeolocationBtn = $('useGeolocation');
  const cityNameEl = $('cityName');
  const setCityBtn = $('setCity');
  const refreshNowBtn = $('refreshNow');

  restore();

  weatherEnabledEl.addEventListener('change', async () => {
    const cur = await getSettings();
    const next = { ...cur, weatherEnabled: weatherEnabledEl.checked };
    await setSettings(next);
  });

  useGeolocationBtn.addEventListener('click', async () => {
    const coords = await getGeolocation();
    if (!coords) {
      alert('定位失败，请检查浏览器定位权限');
      return;
    }
    const cur = await getSettings();
    await setSettings({ ...cur, coords, cityName: '' });
    alert('已更新为自动定位');
  });

  setCityBtn.addEventListener('click', async () => {
    const name = (cityNameEl.value || '').trim();
    if (!name) return;
    const coords = await geocodeCity(name);
    if (!coords) {
      alert('未找到该城市');
      return;
    }
    const cur = await getSettings();
    await setSettings({ ...cur, coords, cityName: name });
    alert('已设置城市');
  });

  refreshNowBtn.addEventListener('click', async () => {
    const cur = await getSettings();
    if (!cur.coords) {
      alert('缺少位置：请设置城市或使用自动定位');
      return;
    }
    const data = await fetchWeather(cur.coords.lat, cur.coords.lon);
    if (data) {
      await chromeStorageSet({ [WEATHER_STORAGE_KEY]: { timestamp: Date.now(), data } });
      alert('已刷新');
    } else {
      alert('刷新失败');
    }
  });

  async function restore() {
    const cur = await getSettings();
    weatherEnabledEl.checked = cur.weatherEnabled !== false;
    cityNameEl.value = cur.cityName || '';
  }

  function getSettings() {
    return chromeStorageGet([SETTINGS_STORAGE_KEY]).then((res) => res[SETTINGS_STORAGE_KEY] || {});
  }
  function setSettings(next) {
    return chromeStorageSet({ [SETTINGS_STORAGE_KEY]: next });
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
    } catch (_) {
      return null;
    }
  }
})();


