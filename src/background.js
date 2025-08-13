// background.js - ShinePet扩展后台脚本
// 处理扩展图标点击事件，切换宠物显示/隐藏状态

// 初始化扩展状态
chrome.runtime.onInstalled.addListener(async () => {
  try {
    // 设置默认状态为显示
    await chrome.storage.sync.set({ 
      petVisible: true 
    });
    console.log('[ShinePet] Extension installed, setting default visible state');
    await updateIcon(true);
  } catch (error) {
    console.error('[ShinePet] Installation error:', error);
  }
});

// 处理扩展图标点击
chrome.action.onClicked.addListener(async (tab) => {
  try {
    // 获取当前显示状态
    const result = await chrome.storage.sync.get(['petVisible']);
    const currentVisible = result.petVisible !== false; // 默认为true
    
    // 切换状态
    const newVisible = !currentVisible;
    await chrome.storage.sync.set({ petVisible: newVisible });
    
    // 更新图标（颜色+标题）
    await updateIcon(newVisible);
    
    // 向所有标签页广播状态变化（包括当前标签页）
    broadcastVisibilityChange(newVisible);
    
    console.log('[ShinePet] Toggled visibility to:', newVisible);
    
  } catch (error) {
    console.error('Error toggling pet visibility:', error);
  }
});

// 更新扩展图标
async function updateIcon(visible) {
  try {
    // 使用Canvas动态生成图标
    const iconData = await generateIcon(visible);
    
    // 设置动态生成的图标
    await chrome.action.setIcon({ 
      imageData: {
        "16": iconData.icon16,
        "32": iconData.icon32,
        "48": iconData.icon48,
        "128": iconData.icon128
      }
    });
    
    // 更新图标提示文字
    const title = visible ? 'ShinePet - 🔵 宠物显示中 (点击隐藏)' : 'ShinePet - ⚫ 宠物已隐藏 (点击显示)';
    await chrome.action.setTitle({ title });
    
    console.log('[ShinePet] Icon updated successfully:', visible ? 'blue' : 'gray');
  } catch (error) {
    console.error('[ShinePet] Failed to update icon:', error);
    
    // 如果图标设置失败，至少更新标题来显示状态
    const title = visible ? 'ShinePet - 🔵 宠物显示中 (点击隐藏)' : 'ShinePet - ⚫ 宠物已隐藏 (点击显示)';
    try {
      await chrome.action.setTitle({ title });
    } catch (titleError) {
      console.error('[ShinePet] Failed to update title:', titleError);
    }
  }
}

// 动态生成图标
async function generateIcon(visible) {
  const sizes = [16, 32, 48, 128];
  const icons = {};
  
  for (const size of sizes) {
    const canvas = new OffscreenCanvas(size, size);
    const ctx = canvas.getContext('2d');
    
    // 设置高质量渲染
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = 'high';
    
    // 清除背景
    ctx.clearRect(0, 0, size, size);
    
    // 计算基本参数 - 增大图标尺寸
    const center = size / 2;
    const radius = size * 0.45; // 从0.35增加到0.45
    const borderWidth = Math.max(2, size / 12); // 从size/16增加到size/12，最小2px
    
    // 绘制主体圆形
    const mainColor = visible ? '#4A90E2' : '#999999'; // 蓝色/灰色
    const borderColor = visible ? '#2E5DA8' : '#666666';
    
    // 绘制填充
    ctx.fillStyle = mainColor;
    ctx.beginPath();
    ctx.arc(center, center, radius, 0, 2 * Math.PI);
    ctx.fill();
    
    // 绘制边框
    ctx.strokeStyle = borderColor;
    ctx.lineWidth = borderWidth;
    ctx.beginPath();
    ctx.arc(center, center, radius, 0, 2 * Math.PI);
    ctx.stroke();
    
    // 绘制眼睛 - 增大眼睛尺寸
    const eyeRadius = Math.max(2, size / 12); // 从size/16增加到size/12
    const eyeOffset = size / 6; // 从size/8增加到size/6，眼睛间距更大
    
    ctx.fillStyle = 'white';
    // 左眼
    ctx.beginPath();
    ctx.arc(center - eyeOffset, center - eyeOffset/2, eyeRadius, 0, 2 * Math.PI);
    ctx.fill();
    // 右眼
    ctx.beginPath();
    ctx.arc(center + eyeOffset, center - eyeOffset/2, eyeRadius, 0, 2 * Math.PI);
    ctx.fill();
    
    // 绘制嘴巴 - 增大嘴巴和线条粗细
    ctx.strokeStyle = 'white';
    ctx.lineWidth = Math.max(2, size / 16); // 从size/24增加到size/16，最小2px
    ctx.beginPath();
    const mouthY = center + eyeOffset/2;
    const mouthRadius = size / 5; // 从size/6增加到size/5
    
    if (visible) {
      // 显示状态 - 笑脸
      ctx.arc(center, mouthY - eyeOffset/4, mouthRadius, 0, Math.PI, false);
    } else {
      // 隐藏状态 - 难过脸
      ctx.arc(center, mouthY + eyeOffset/2, mouthRadius, 0, Math.PI, true);
    }
    ctx.stroke();
    
    // 如果是隐藏状态，添加禁用标识 - 增加线条粗细
    if (!visible) {
      ctx.strokeStyle = '#FF4444';
      ctx.lineWidth = Math.max(3, size / 8); // 从size/12增加到size/8，最小3px
      ctx.beginPath();
      ctx.moveTo(size * 0.15, size * 0.15); // 调整起始位置，让线条更长
      ctx.lineTo(size * 0.85, size * 0.85); // 调整结束位置
      ctx.stroke();
    }
    
    // 获取ImageData
    const imageData = ctx.getImageData(0, 0, size, size);
    icons[`icon${size}`] = imageData;
  }
  
  return icons;
}

// 向所有标签页广播显示状态变化
async function broadcastVisibilityChange(visible) {
  try {
    const tabs = await chrome.tabs.query({});
    
    for (const tab of tabs) {
      // 只向有效的网页标签页发送消息
      if (tab.id && tab.url && 
          !tab.url.startsWith('chrome://') && 
          !tab.url.startsWith('chrome-extension://') &&
          !tab.url.startsWith('moz-extension://') &&
          !tab.url.startsWith('edge://') &&
          tab.status === 'complete') {
        try {
          await chrome.tabs.sendMessage(tab.id, {
            action: 'togglePetVisibility',
            visible: visible
          });
        } catch (error) {
          // 静默忽略 - 这是正常情况，某些标签页可能没有content script
          if (chrome.runtime.lastError) {
            // 清除lastError以避免控制台警告
            chrome.runtime.lastError;
          }
        }
      }
    }
    console.log('[ShinePet] Broadcasted visibility change to all tabs:', visible);
  } catch (error) {
    console.error('Error broadcasting visibility change:', error);
  }
}

// 监听来自content script的消息
chrome.runtime.onMessage.addListener(async (message, sender, sendResponse) => {
  if (message.action === 'getPetVisibility') {
    try {
      const result = await chrome.storage.sync.get(['petVisible']);
      const visible = result.petVisible !== false; // 默认为true
      sendResponse({ visible });
      
      // 同时更新图标状态
      await updateIcon(visible);
      console.log('[ShinePet] Returned visibility state:', visible);
    } catch (error) {
      console.error('Error getting pet visibility:', error);
      sendResponse({ visible: true });
    }
    return true; // 保持消息通道开放
  }
  
  if (message.action === 'openOptions') {
    try {
      await chrome.runtime.openOptionsPage();
      console.log('[ShinePet] Options page opened');
      sendResponse({ success: true });
    } catch (error) {
      console.error('[ShinePet] Failed to open options page:', error);
      sendResponse({ success: false, error: error.message });
    }
    return true; // 保持消息通道开放
  }
});

// 扩展启动时恢复图标状态
chrome.runtime.onStartup.addListener(async () => {
  try {
    const result = await chrome.storage.sync.get(['petVisible']);
    const visible = result.petVisible !== false;
    console.log('[ShinePet] Extension startup, restoring visible state:', visible);
    await updateIcon(visible);
  } catch (error) {
    console.error('[ShinePet] Startup error:', error);
    await updateIcon(true); // 默认显示
  }
});
