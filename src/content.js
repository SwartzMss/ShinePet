/*
  ShinePet content script
  - 悬浮电子宠物
  - 拖拽并持久化位置（chrome.storage.sync）
  - 点击：挥手（轻度摇摆）
  - 双击：跳舞（高能摇摆，3 秒）
*/

(function initShinePet() {
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
  petImg.src = chrome.runtime.getURL('assets/pet.svg');
  petWrapper.appendChild(petImg);

  container.appendChild(petWrapper);
  document.documentElement.appendChild(container);

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
})();


