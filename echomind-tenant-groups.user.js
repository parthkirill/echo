// ==UserScript==
// @name         EchoMind Tenant Groups
// @namespace    echomind-tenant-groups
// @version      2.7.4
// @description  Фильтрация, сортировка и экспорт тенантов EchoMind + интеграция Chatwoot → EchoMind Test prompts.
// @match        https://echomind.space/*
// @match        https://*.echomind.space/*
// @match        https://app.chatwoot.com/*
// @updateURL    https://github.com/parthkirill/echo/raw/main/echomind-tenant-groups.user.js
// @downloadURL  https://github.com/parthkirill/echo/raw/main/echomind-tenant-groups.user.js
// @grant        GM_getValue
// @grant        GM_setValue
// @grant        GM_addValueChangeListener
// @grant        GM_registerMenuCommand
// @grant        GM_openInTab
// @run-at       document-idle
// @noframes
// ==/UserScript==

/*
 * Перенос расширения EchoMind Tenant Groups v1.1.0 в один userscript.
 *  - storage.local      → хранилище Tampermonkey (GM_getValue / GM_setValue);
 *  - storage.onChanged  → GM_addValueChangeListener (синхронизация между вкладками);
 *  - страница настроек  → окно поверх EchoMind (в Shadow DOM, стили сайта не мешают);
 *  - popup              → выбор проекта на панели + пункт в меню Tampermonkey;
 *  - background.js      → не нужен: настройки открываются в той же вкладке.
 * Новое: сортировка карточек, закрепление тенантов, быстрый поиск, импорт/экспорт.
 * 2.6.0: экспорт переделан под новый интерфейс (Products → Agents → Answer Agent).
 * 2.7.0: модуль Chatwoot → EchoMind Test prompts (автосбор диалога до сообщения и заполнение Test prompts).
 */
(() => {
  'use strict';
  if (window.__EMTF_CONTENT_LOADED__) return;
  window.__EMTF_CONTENT_LOADED__ = true;

  const isChatwootHost = location.hostname === 'app.chatwoot.com' || location.hostname.includes('chatwoot');
  const isEchoMindHost = location.hostname === 'echomind.space' || location.hostname.endsWith('.echomind.space');

  /* ======================= Общие константы и хелперы ======================= */

  const CONFIG_KEY = 'emtf_config_v1';
  const SEEN_KEY = 'emtf_seen_tenants_v1';
  const HANDOFF_KEY = 'emtf_handoff_v1';
  const TENANT_MAP_KEY = 'emtf_tenant_map_v1';
  const HANDOFF_TTL = 5 * 60 * 1000; // 5 минут
  const SCHEMA_VERSION = 3;
  const ALL = '__all__';
  const UNASSIGNED = '__unassigned__';

  function normalizeTitle(name) {
    return String(name ?? '').trim().replace(/\s+/g, ' ').toLocaleLowerCase();
  }

  function cleanName(name) {
    return String(name ?? '').trim().replace(/\s+/g, ' ').slice(0, 120);
  }

  function hasTenantContext() {
    const uuidRe = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i;
    if (uuidRe.test(location.pathname)) return true;
    if (/(?:^|\/)(agents?|prompts?|test|settings|documents?|tags?|functions?)(?:\/|$)/i.test(location.pathname)) return true;

    const text = document.body?.innerText || '';
    if (new RegExp(`(?:Tenant|Product)\\s*Id\\s*:\\s*${uuidRe.source}`, 'i').test(text)) return true;

    return false;
  }

  const INBOX_TENANT_MAP = {
    // Crorebet / Crore
    'crorebet_email': 'Test email',
    'crorebet email': 'Test email',
    'crore_email': 'Test email',
    'crore email': 'Test email',
    'crorebet_telegram': 'Crore Telegram',
    'crorebet telegram': 'Crore Telegram',
    'crore_telegram': 'Crore Telegram',
    'crore telegram': 'Crore Telegram',
    'crorebet': 'Crorebet',
    'crore': 'Crorebet',
    'crorebet_vip': 'Crorebet VIP',
    'crorebet vip': 'Crorebet VIP',
    'crore_vip': 'Crorebet VIP',
    'crore vip': 'Crorebet VIP',
    'crorebet_vip_telegram': 'Crorebet VIP',
    'crorebet vip telegram': 'Crorebet VIP',
    'crore_vip_telegram': 'Crorebet VIP',
    'crore vip telegram': 'Crorebet VIP',
    'crorebet_vip_tg': 'Crorebet VIP',
    'crorebet vip tg': 'Crorebet VIP',
    'crore_vip_tg': 'Crorebet VIP',
    'crore vip tg': 'Crorebet VIP',
    'crorebet_telegram_vip': 'Crorebet VIP',
    'crorebet telegram vip': 'Crorebet VIP',
    'crorebet_vip_email': 'Crorebet VIP email',
    'crorebet vip email': 'Crorebet VIP email',
    'crore_vip_email': 'Crorebet VIP email',
    'crore vip email': 'Crorebet VIP email',
    'crorebet_test_space': 'crore test space',
    'crorebet test space': 'crore test space',
    'crore_test_space': 'crore test space',
    'crore test space': 'crore test space',

    // 4Rabet / 4ra
    '4rabet_telegram': '4ra Telegram',
    '4rabet telegram': '4ra Telegram',
    '4ra_telegram': '4ra Telegram',
    '4ra telegram': '4ra Telegram',
    '4rabet_email': '4Rabet Email',
    '4rabet email': '4Rabet Email',
    '4ra_email': '4Rabet Email',
    '4ra email': '4Rabet Email',
    '4rabet': '4ra',
    '4ra': '4ra',
    '4rabet_vip': '4Rabet VIP',
    '4rabet vip': '4Rabet VIP',
    '4ra_vip': '4Rabet VIP',
    '4ra vip': '4Rabet VIP',
    '4rabet_vip_telegram': '4Rabet VIP',
    '4rabet vip telegram': '4Rabet VIP',
    '4ra_vip_telegram': '4Rabet VIP',
    '4ra vip telegram': '4Rabet VIP',
    '4rabet_vip_tg': '4Rabet VIP',
    '4rabet vip tg': '4Rabet VIP',
    '4ra_vip_tg': '4Rabet VIP',
    '4ra vip tg': '4Rabet VIP',
    '4rabet_telegram_vip': '4Rabet VIP',
    '4rabet telegram vip': '4Rabet VIP',
    '4rabet_vip_email': '4Rabet VIP email',
    '4rabet vip email': '4Rabet VIP email',
    '4ra_vip_email': '4Rabet VIP email',
    '4ra vip email': '4Rabet VIP email',
    '4rabet_test_space': '4ra Test space',
    '4rabet test space': '4ra Test space',
    '4ra_test_space': '4ra Test space',
    '4ra test space': '4ra Test space',

    // Crorewin
    'crorewin': 'Crorewin',
    'crorewin_email': 'Crorewin Email',
    'crorewin email': 'Crorewin Email',
    'crorewin_telegram': 'Crorewin Telegram',
    'crorewin telegram': 'Crorewin Telegram',

    // Starkbet
    'starkbet': 'Starkbet',
    'starkbet_telegram': 'Starkbet Telegram',
    'starkbet telegram': 'Starkbet Telegram',
    'starkbet_email': 'Starkbet Email',
    'starkbet email': 'Starkbet Email',

    // Platabet / Другие
    'platabet': 'Platabet',
    'platabet_telegram': 'Platabet Telegram',
    'platabet telegram': 'Platabet Telegram',
    'platabet_email': 'Platabet Email',
    'platabet email': 'Platabet Email',
    'vivowin': 'VivoWin',
    'australia': 'Australia',
    'call centre': 'Call Centre',
    'call_centre': 'Call Centre',
    'test space': 'Test Space',
    'test_space': 'Test Space',
    'vip test': 'VIP test',
    'vip_test': 'VIP test'
  };

  function mapInboxToTenant(name) {
    if (!name) return '';
    const clean = cleanName(name);
    const rawNorm = normalizeTitle(clean);
    const spaceNorm = normalizeTitle(clean.replace(/[_\s]+/g, ' '));
    if (INBOX_TENANT_MAP[rawNorm]) return INBOX_TENANT_MAP[rawNorm];
    if (INBOX_TENANT_MAP[spaceNorm]) return INBOX_TENANT_MAP[spaceNorm];

    // Попытка сопоставления префиксов crorebet -> crore, 4rabet -> 4ra
    const croreVariant = spaceNorm.replace(/\bcrorebet\b/g, 'crore');
    if (INBOX_TENANT_MAP[croreVariant]) return INBOX_TENANT_MAP[croreVariant];
    const fourRaVariant = spaceNorm.replace(/\b4rabet\b/g, '4ra');
    if (INBOX_TENANT_MAP[fourRaVariant]) return INBOX_TENANT_MAP[fourRaVariant];

    // Авто-правило для VIP Telegram: если есть VIP и (telegram|tg), но нет email
    // 4rabet / 4ra VIP telegram -> '4Rabet VIP'
    if (/\b(4rabet|4ra)\b/i.test(spaceNorm) && /\bvip\b/i.test(spaceNorm) && /\b(telegram|tg)\b/i.test(spaceNorm) && !/\bemail\b/i.test(spaceNorm)) {
      return '4Rabet VIP';
    }
    // Crorebet / Crore VIP telegram -> 'Crorebet VIP'
    if (/\b(crorebet|crore)\b/i.test(spaceNorm) && /\bvip\b/i.test(spaceNorm) && /\b(telegram|tg)\b/i.test(spaceNorm) && !/\bemail\b/i.test(spaceNorm)) {
      return 'Crorebet VIP';
    }

    // По умолчанию заменяем подчеркивания на пробелы
    return clean.replace(/[_\s]+/g, ' ').trim();
  }

  function gmRead(key) {
    try {
      const value = GM_getValue(key, null);
      return typeof value === 'string' ? JSON.parse(value) : value;
    } catch (_) {
      return null;
    }
  }

  function gmWrite(key, value) {
    try {
      GM_setValue(key, JSON.parse(JSON.stringify(value)));
    } catch (err) {
      console.warn('[EchoMind Tenant Groups] Не удалось сохранить:', err);
    }
  }

  /* ========================================================================= */
  /* ========================= МОДУЛЬ 1: CHATWOOT ============================ */
  /* ========================================================================= */

  if (isChatwootHost) {
    runChatwootModule();
    return;
  }

  function runChatwootModule() {
    const CW_SELECTORS = {
      panel: 'ul.conversation-panel, .conversation-panel',
      bubble: '[data-message-id]',
      bubbleContent: '.prose.prose-bubble, .prose-bubble, .message-text',
      headerWrap: '.conversation-details-wrap',
      headerIdBtn: '.conversation-details-wrap button.conversation--header-, .conversation-details-wrap button',
      inboxName: '.conversation-details-wrap .conversation--header- span.truncate.text-label-small, .conversation-details-wrap .conversation--header- span',
      meta: '.text-xs.flex.items-center, div.text-xs',
      time: 'time'
    };

    const cwStyle = document.createElement('style');
    cwStyle.id = 'emtf-cw-style';
    cwStyle.textContent = `
.emtf-cw-btn {
  display: inline-flex !important;
  align-items: center !important;
  justify-content: center !important;
  margin-left: 6px !important;
  padding: 1px 5px !important;
  font-size: 11px !important;
  font-weight: 600 !important;
  line-height: 1.2 !important;
  border-radius: 4px !important;
  background: rgba(148, 163, 184, 0.15) !important;
  border: 1px solid rgba(148, 163, 184, 0.3) !important;
  color: #94a3b8 !important;
  cursor: pointer !important;
  transition: all 0.15s ease-out !important;
  vertical-align: middle !important;
  user-select: none !important;
}
.emtf-cw-btn:hover {
  background: rgba(237, 62, 81, 0.2) !important;
  border-color: #ed3e51 !important;
  color: #f9b4c0 !important;
}
.emtf-cw-btn:disabled {
  opacity: 0.5 !important;
  cursor: not-allowed !important;
}
.emtf-cw-toast {
  position: fixed !important;
  right: 20px !important;
  bottom: 20px !important;
  z-index: 999999 !important;
  background: #2b2f48 !important;
  color: #e9edff !important;
  border: 1px solid #4a5175 !important;
  border-radius: 8px !important;
  padding: 10px 16px !important;
  font: 13px/1.4 Inter, system-ui, -apple-system, sans-serif !important;
  box-shadow: 0 8px 24px rgba(0,0,0,0.35) !important;
  transition: opacity 0.2s !important;
}
.emtf-cw-toast.error {
  background: #594051 !important;
  border-color: #ab5e70 !important;
  color: #ffc7cf !important;
}
`;
    (document.head || document.documentElement).append(cwStyle);

    let toastTimer = 0;
    function showToast(text, isError = false) {
      let toast = document.getElementById('emtf-cw-toast');
      if (!toast) {
        toast = document.createElement('div');
        toast.id = 'emtf-cw-toast';
        document.body.append(toast);
      }
      toast.className = `emtf-cw-toast ${isError ? 'error' : ''}`;
      toast.textContent = text;
      toast.style.display = 'block';
      clearTimeout(toastTimer);
      toastTimer = setTimeout(() => {
        if (toast) toast.style.display = 'none';
      }, 3500);
    }

    function getConversationId() {
      const match = location.pathname.match(/\/conversations\/(\d+)/i);
      if (match) return match[1];
      const headerText = document.querySelector(CW_SELECTORS.headerWrap)?.innerText || '';
      const idMatch = headerText.match(/#(\d+)/);
      return idMatch ? idMatch[1] : '';
    }

    function getInboxName() {
      const header = document.querySelector(CW_SELECTORS.headerWrap);
      let rawName = '';
      if (header) {
        const inboxSpan = header.querySelector('.conversation--header- span.truncate.text-label-small, .conversation--header- div.flex span.truncate');
        if (inboxSpan && inboxSpan.textContent.trim()) {
          rawName = cleanName(inboxSpan.textContent);
        } else {
          const channelIcon = header.querySelector('[class*="i-woot-"]');
          if (channelIcon && channelIcon.parentElement) {
            const next = channelIcon.parentElement.nextElementSibling || channelIcon.nextElementSibling;
            if (next && next.textContent.trim()) rawName = cleanName(next.textContent);
          }
        }
      }
      return mapInboxToTenant(rawName);
    }

    function isPrivateOrActivity(bubble) {
      if (!bubble) return true;

      // 1. Системные события (activity) центрируются в чате Chatwoot
      if (bubble.classList.contains('justify-center')) return true;

      // 2. Системные сообщения не являются входящими или исходящими
      const isUser = bubble.classList.contains('justify-start') ||
        Boolean(bubble.querySelector('.left-bubble, [class*="left-bubble"], .bg-n-slate-4'));
      const isAgent = bubble.classList.contains('justify-end') ||
        Boolean(bubble.querySelector('.right-bubble, [class*="right-bubble"], .bg-n-solid-blue'));
      if (!isUser && !isAgent) return true;

      // 3. Приватные заметки (private notes) сотрудников
      const classes = bubble.className + ' ' + (bubble.querySelector('.left-bubble, .right-bubble')?.className || '');
      if (/bg-n-amber|is-private|private-note/i.test(classes)) return true;
      if (bubble.querySelector('.i-lucide-lock, [class*="i-lucide-lock"], [class*="i-ph-lock"]')) return true;

      return false;
    }

    function extractMediaUrls(bubble) {
      if (!bubble) return [];
      const urls = [];
      const seen = new Set();

      const addUrl = (url) => {
        if (!url || typeof url !== 'string') return;
        const clean = url.trim();
        if (!clean || clean.startsWith('javascript:') || clean.startsWith('data:image/svg')) return;
        if (!seen.has(clean)) {
          seen.add(clean);
          urls.push(clean);
        }
      };

      // 1. Полноразмерные ссылки на вложения / active_storage / download
      const links = bubble.querySelectorAll('a[href*="active_storage"], a[href*="/rails/"], a[download], a[class*="attachment"], a.image-wrapper');
      for (const a of links) {
        if (!a.closest('[class*="grid-area:avatar"], .avatar, [class*="avatar"]')) {
          addUrl(a.href);
        }
      }

      // 2. Теги <img> (за исключением аватаров)
      const imgs = bubble.querySelectorAll('img');
      for (const img of imgs) {
        if (img.closest('[class*="grid-area:avatar"], .avatar, [class*="avatar"]') || img.getAttribute('role') === 'presentation') {
          continue;
        }
        // Если картинка обёрнута ссылкой (полноразмерная в active_storage)
        const parentLink = img.closest('a[href]');
        if (parentLink && parentLink.href && !parentLink.href.startsWith('javascript:')) {
          addUrl(parentLink.href);
        } else {
          const src = img.currentSrc || img.src || img.getAttribute('src');
          addUrl(src);
        }
      }

      // 3. Другие медиа (video, audio)
      const media = bubble.querySelectorAll('video[src], audio[src], source[src]');
      for (const m of media) {
        if (!m.closest('[class*="grid-area:avatar"], .avatar, [class*="avatar"]')) {
          addUrl(m.src || m.getAttribute('src'));
        }
      }

      return urls;
    }

    function extractMessageLines(bubble, role) {
      const contentEl = bubble.querySelector(CW_SELECTORS.bubbleContent) || bubble.querySelector('.prose, p');
      let text = '';
      if (contentEl) {
        text = (contentEl.innerText || contentEl.textContent || '')
          .replace(/\r?\n+/g, ' ')
          .replace(/\s+/g, ' ')
          .trim();
      }

      const mediaUrls = extractMediaUrls(bubble);
      const result = [];

      if (text) {
        result.push(`${role}: ${text}`);
      }

      if (mediaUrls.length > 0) {
        for (const url of mediaUrls) {
          result.push(`${role}: ${url}`);
        }
      } else if (!text) {
        if (bubble.querySelector('img:not([class*="avatar"])')) {
          result.push(`${role}: [image]`);
        } else if (bubble.querySelector('.file-uploads, a[download], [class*="attachment"]')) {
          result.push(`${role}: [attachment]`);
        }
      }

      return result;
    }

    function extractMessageText(bubble) {
      return extractMessageLines(bubble, 'User').map(l => l.replace(/^User:\s*/, '')).join(' ');
    }

    function getMessageRole(bubble) {
      if (bubble.classList.contains('justify-start') || bubble.querySelector('.left-bubble, .bg-n-slate-4')) {
        return 'User';
      }
      if (bubble.classList.contains('justify-end') || bubble.querySelector('.right-bubble, .bg-n-solid-blue')) {
        return 'Assistant';
      }
      return null;
    }

    async function loadFullHistory(panel) {
      showToast('Собираю диалог… (подгрузка сообщений)');
      const fromBottom = panel.scrollHeight - panel.scrollTop;
      const pause = ms => new Promise(r => setTimeout(r, ms));
      let last = -1;
      let stableSince = Date.now();
      const start = Date.now();
      while (Date.now() - start < 20000) {
        panel.scrollTop = 0;
        await pause(250);
        const count = panel.querySelectorAll(CW_SELECTORS.bubble).length;
        if (count !== last) { last = count; stableSince = Date.now(); }
        else if (Date.now() - stableSince > 1500) break;
      }
      panel.scrollTop = panel.scrollHeight - fromBottom;
      return true;
    }

    async function handleMessageClick(targetBubble, btn) {
      btn.disabled = true;
      try {
        const convId = getConversationId();
        if (!convId) {
          showToast('Не удалось определить ID диалога (#ID)', true);
          return;
        }
        const inbox = getInboxName();

        const panel = document.querySelector(CW_SELECTORS.panel);
        if (!panel) {
          showToast('Не найдена панель сообщений Chatwoot', true);
          return;
        }

        await loadFullHistory(panel);

        const allBubbles = [...panel.querySelectorAll(CW_SELECTORS.bubble)];
        const targetIndex = allBubbles.indexOf(targetBubble);
        if (targetIndex === -1) {
          showToast('Целевое сообщение не найдено в списке', true);
          return;
        }

        const slice = allBubbles.slice(0, targetIndex + 1);
        const lines = [];

        for (const b of slice) {
          if (isPrivateOrActivity(b)) continue;
          const role = getMessageRole(b);
          if (!role) continue;
          const msgLines = extractMessageLines(b, role);
          if (msgLines && msgLines.length) {
            lines.push(...msgLines);
          }
        }

        if (!lines.length) {
          showToast('Не удалось извлечь ни одного сообщения', true);
          return;
        }

        const dialog = lines.join('\n');

        const payload = {
          conversationId: convId,
          tenantName: inbox,
          dialog,
          at: Date.now()
        };
        gmWrite(HANDOFF_KEY, payload);

        const tenantMap = gmRead(TENANT_MAP_KEY) || {};
        const cached = inbox ? tenantMap[normalizeTitle(inbox)] : null;
        let targetUrl = 'https://www.echomind.space/tenants';
        if (cached && cached.id) {
          targetUrl = `https://www.echomind.space/tenants/${cached.id}/agents/answer/prompts`;
        }

        showToast(`Диалог (${lines.length} строк) отправлен. Открываю EchoMind…`);
        if (typeof GM_openInTab === 'function') {
          GM_openInTab(targetUrl, { active: true, insert: true });
        } else {
          window.open(targetUrl, '_blank');
        }
      } catch (err) {
        showToast(`Ошибка сбора диалога: ${err.message || err}`, true);
      } finally {
        setTimeout(() => { btn.disabled = false; }, 1000);
      }
    }

    function injectButtons() {
      const bubbles = document.querySelectorAll(CW_SELECTORS.bubble);
      for (const bubble of bubbles) {
        if (bubble.querySelector('.emtf-cw-btn')) continue;
        if (isPrivateOrActivity(bubble)) continue;

        const timeEl = bubble.querySelector('time');
        const metaBox = timeEl ? timeEl.closest('.text-xs, div') : null;

        const btn = document.createElement('button');
        btn.type = 'button';
        btn.className = 'emtf-cw-btn';
        btn.title = 'Отправить диалог до этого сообщения в EchoMind';
        btn.textContent = '⇪';
        btn.addEventListener('click', (e) => {
          e.stopPropagation();
          e.preventDefault();
          handleMessageClick(bubble, btn);
        });

        if (timeEl && metaBox) {
          if (timeEl.nextSibling) {
            metaBox.insertBefore(btn, timeEl.nextSibling);
          } else {
            metaBox.append(btn);
          }
        } else {
          // Для сгруппированных сообщений без <time> (например, скриншот из серии)
          const bubbleWrap = bubble.querySelector('.text-xs, [class*="grid-area:bubble"], .left-bubble, .right-bubble') || bubble;
          bubbleWrap.append(btn);
        }
      }
    }

    let injectTimer = 0;
    function scheduleInject() {
      clearTimeout(injectTimer);
      injectTimer = setTimeout(injectButtons, 120);
    }

    const observer = new MutationObserver(scheduleInject);
    observer.observe(document.body || document.documentElement, { childList: true, subtree: true });
    scheduleInject();
    window.addEventListener('popstate', scheduleInject);
  }

  /* ========================================================================= */
  /* ========================= МОДУЛЬ 2: ECHOMIND ============================ */
  /* ========================================================================= */

  const VIEWS = {
    site: 'Карточки сайта',
    tiles: 'Плитка',
    rows: 'Строки по проектам',
    columns: 'Колонки по проектам',
    list: 'Список'
  };

  function normalizeUi(ui) {
    const value = ui && typeof ui === 'object' ? ui : {};
    return {
      view: Object.hasOwn(VIEWS, value.view) ? value.view : 'site',
      collapsed: value.collapsed === true,   // панель свёрнута в одну строку
      hidden: value.hidden === true,         // панель скрыта полностью (Alt+P / меню)
      showTags: value.showTags !== false     // подписи проектов на карточках
    };
  }

  const SORTS = {
    site: 'Как на сайте',
    project: 'По проектам',
    alpha: 'По алфавиту',
    manual: 'Вручную'
  };

  const DEFAULT_GROUPS = [
    {
      id: '4rabet', name: '4Rabet',
      tenants: ['4ra', '4ra Telegram', '4ra Test space', '4Rabet Email', '4Rabet VIP email', '4Rabet VIP']
    },
    {
      id: 'crorebet', name: 'Crorebet',
      tenants: ['Crorebet', 'Crorebet VIP', 'Crorebet VIP email', 'Crore Telegram', 'crore test space', 'Test email']
    },
    {
      id: 'crorewin', name: 'Crorewin',
      tenants: ['Crorewin', 'Crorewin Email']
    },
    {
      id: 'starkbet', name: 'Starkbet',
      tenants: ['Starkbet', 'Starkbet Telegram', 'Starkbet Email']
    },
    {
      id: 'other', name: 'Другие',
      tenants: ['VIP test', 'Test Space', 'Call Centre', 'VivoWin', 'Platabet', 'Australia']
    }
  ];

  function normalizeTitle(name) {
    return String(name ?? '').trim().replace(/\s+/g, ' ').toLocaleLowerCase();
  }

  function cleanName(name) {
    return String(name ?? '').trim().replace(/\s+/g, ' ').slice(0, 120);
  }

  function hasTenantContext() {
    const uuidRe = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i;
    if (uuidRe.test(location.pathname)) return true;
    if (/(?:^|\/)(agents?|prompts?|test|settings|documents?|tags?|functions?)(?:\/|$)/i.test(location.pathname)) return true;

    const text = document.body?.innerText || '';
    if (new RegExp(`(?:Tenant|Product)\\s*Id\\s*:\\s*${uuidRe.source}`, 'i').test(text)) return true;

    return false;
  }

  function cleanSeen(items, limit = 1000) {
    const result = [];
    const known = new Set();
    for (const candidate of (Array.isArray(items) ? items : [])) {
      const title = cleanName(candidate);
      const key = normalizeTitle(title);
      if (key && !known.has(key)) {
        result.push(title);
        known.add(key);
      }
      if (result.length >= limit) break;
    }
    return result;
  }

  function defaultConfig() {
    return {
      schemaVersion: SCHEMA_VERSION,
      selected: ALL,
      sort: 'site',
      pinned: [],
      order: [],
      ui: normalizeUi(),
      groups: DEFAULT_GROUPS.map(group => ({
        id: group.id, name: group.name, tenants: [...group.tenants]
      }))
    };
  }

  function normalizeConfig(raw) {
    if (!raw || !Array.isArray(raw.groups)) return defaultConfig();
    const seenIds = new Set();
    const groups = [];
    for (const candidate of raw.groups.slice(0, 100)) {
      if (!candidate || typeof candidate !== 'object') continue;
      const name = cleanName(candidate.name);
      const id = String(candidate.id ?? '').slice(0, 100);
      if (!name || !id || seenIds.has(id) || id === ALL || id === UNASSIGNED) continue;
      seenIds.add(id);
      const assignedInThisGroup = new Set();
      const tenants = [];
      for (const title of (Array.isArray(candidate.tenants) ? candidate.tenants : []).slice(0, 1000)) {
        const cleaned = cleanName(title);
        const key = normalizeTitle(cleaned);
        // Тенант может быть в нескольких группах, но в одной группе — один раз.
        if (key && !assignedInThisGroup.has(key)) {
          tenants.push(cleaned);
          assignedInThisGroup.add(key);
        }
      }
      groups.push({ id, name, tenants });
    }
    // Миграция с 1.0.1: переносим только прежнее назначение Test email по умолчанию.
    if (Number(raw.schemaVersion || 1) < 2) {
      const testEmailKey = normalizeTitle('Test email');
      const currentOwner = groups.find(group =>
        group.tenants.some(title => normalizeTitle(title) === testEmailKey));
      const crorebet = groups.find(group => group.id === 'crorebet');
      if (currentOwner?.id === 'other' && crorebet) {
        currentOwner.tenants = currentOwner.tenants.filter(title =>
          normalizeTitle(title) !== testEmailKey);
        crorebet.tenants.push('Test email');
      }
    }
    const selected = String(raw.selected ?? ALL);
    return {
      schemaVersion: SCHEMA_VERSION,
      selected: selected === ALL || selected === UNASSIGNED || groups.some(group => group.id === selected)
        ? selected : ALL,
      sort: Object.hasOwn(SORTS, raw.sort) ? raw.sort : 'site',
      ui: normalizeUi(raw.ui),
      pinned: cleanSeen(raw.pinned, 300),
      order: cleanSeen(raw.order, 1000), // ручной порядок (перетаскивание)
      groups
    };
  }

  function groupIds(config, name) {
    const key = normalizeTitle(name);
    if (!key) return [];
    return config.groups
      .filter(group => group.tenants.some(title => normalizeTitle(title) === key))
      .map(group => group.id);
  }

  function belongsTo(config, title) {
    if (config.selected === ALL) return true;
    const membership = groupIds(config, title);
    return config.selected === UNASSIGNED
      ? membership.length === 0
      : membership.includes(config.selected);
  }

  // Одна галочка не трогает остальные группы тенанта.
  function setMembership(config, title, groupId, enabled) {
    const name = cleanName(title);
    const next = normalizeConfig(config);
    if (!name) return next;
    const group = next.groups.find(item => item.id === groupId);
    if (!group) return next;
    const key = normalizeTitle(name);
    group.tenants = group.tenants.filter(item => normalizeTitle(item) !== key);
    if (enabled) group.tenants.push(name);
    return next;
  }

  function clearMemberships(config, title) {
    const next = normalizeConfig(config);
    const key = normalizeTitle(title);
    if (!key) return next;
    for (const group of next.groups) {
      group.tenants = group.tenants.filter(item => normalizeTitle(item) !== key);
    }
    return next;
  }

  function isPinned(config, title) {
    const key = normalizeTitle(title);
    return config.pinned.some(item => normalizeTitle(item) === key);
  }

  function togglePinned(config, title) {
    const next = normalizeConfig(config);
    const key = normalizeTitle(title);
    if (isPinned(next, title)) {
      next.pinned = next.pinned.filter(item => normalizeTitle(item) !== key);
    } else {
      next.pinned.push(cleanName(title));
    }
    return next;
  }

  function makeId() {
    if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
      return `group-${crypto.randomUUID()}`;
    }
    return `group-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
  }

  /* ======================= Хранилище Tampermonkey ======================= */

  function gmRead(key) {
    try {
      const value = GM_getValue(key, null);
      return typeof value === 'string' ? JSON.parse(value) : value;
    } catch (_) {
      return null;
    }
  }

  function gmWrite(key, value) {
    try {
      GM_setValue(key, JSON.parse(JSON.stringify(value)));
    } catch (err) {
      console.warn('[EchoMind Tenant Groups] Не удалось сохранить:', err);
    }
  }

  const state = {
    config: normalizeConfig(gmRead(CONFIG_KEY)),
    seen: cleanSeen(gmRead(SEEN_KEY))
  };
  {
    const raw = gmRead(CONFIG_KEY);
    if (!raw || Number(raw.schemaVersion || 1) < SCHEMA_VERSION) gmWrite(CONFIG_KEY, state.config);
  }

  const listeners = new Set();
  const notify = () => listeners.forEach(fn => {
    try { fn(); } catch (err) { console.warn('[EchoMind Tenant Groups]', err); }
  });

  function saveConfig(next) {
    state.config = normalizeConfig(next);
    gmWrite(CONFIG_KEY, state.config);
    notify();
    return state.config;
  }

  function saveSeen(list) {
    state.seen = cleanSeen(list);
    gmWrite(SEEN_KEY, state.seen);
    notify();
  }

  // Изменения из другой вкладки EchoMind применяются сразу.
  if (typeof GM_addValueChangeListener === 'function') {
    GM_addValueChangeListener(CONFIG_KEY, (_key, _old, value, remote) => {
      if (!remote) return;
      state.config = normalizeConfig(typeof value === 'string' ? JSON.parse(value) : value);
      notify();
    });
    GM_addValueChangeListener(SEEN_KEY, (_key, _old, value, remote) => {
      if (!remote) return;
      state.seen = cleanSeen(typeof value === 'string' ? JSON.parse(value) : value);
      notify();
    });
  }

  /* ======================= Сортировка ======================= */

  const collator = new Intl.Collator('ru', { sensitivity: 'base', numeric: true });

  // Внутри проекта: основной → VIP → Email → Telegram → прочее → тестовые.
  function kindRank(title) {
    const t = normalizeTitle(title);
    if (/\btest\b|тест/.test(t)) return 9;
    const vip = /\bvip\b/.test(t);
    const email = /e-?mail|почт/.test(t);
    const telegram = /telegram|\btg\b|телеграм/.test(t);
    if (vip && email) return 2;
    if (vip) return 1;
    if (email) return 3;
    if (telegram) return 4;
    if (/call|centre|center|колл/.test(t)) return 5;
    return 0;
  }

  function groupRank(config, title) {
    const key = normalizeTitle(title);
    const index = config.groups.findIndex(group =>
      group.tenants.some(item => normalizeTitle(item) === key));
    return index === -1 ? config.groups.length : index;
  }

  const orderMaps = new WeakMap();
  function orderIndex(config, title) {
    let map = orderMaps.get(config.order);
    if (!map) {
      map = new Map(config.order.map((item, index) => [normalizeTitle(item), index]));
      orderMaps.set(config.order, map);
    }
    return map.get(normalizeTitle(title)) ?? -1;
  }

  // Ручной порядок: перетащенные тенанты по своим местам, остальные — после них.
  function compareManual(config, a, b) {
    const ia = orderIndex(config, a.title);
    const ib = orderIndex(config, b.title);
    if (ia === -1 && ib === -1) return 0;
    if (ia === -1) return 1;
    if (ib === -1) return -1;
    return ia - ib;
  }

  function compareEntries(config, a, b) {
    if (a.pinned !== b.pinned) return a.pinned ? -1 : 1;
    switch (config.sort) {
      case 'manual':
        return compareManual(config, a, b) || a.index - b.index;
      case 'alpha':
        return collator.compare(a.title, b.title) || a.index - b.index;
      case 'project':
        return groupRank(config, a.title) - groupRank(config, b.title) ||
          compareManual(config, a, b) ||
          kindRank(a.title) - kindRank(b.title) ||
          collator.compare(a.title, b.title) || a.index - b.index;
      default:
        return a.index - b.index;
    }
  }

  /* ======================= Стили панели на странице ======================= */

  const FONT = "Inter, system-ui, -apple-system, 'Segoe UI', sans-serif";
  const pageStyle = document.createElement('style');
  pageStyle.id = 'emtf-page-style';
  pageStyle.textContent = `
[data-emtf-hidden="true"], [data-emtf-off="true"] { display: none !important; }
[data-emtf-pinned="true"] { outline: 1px solid rgba(249,180,192,.55) !important; outline-offset: -1px !important; }
[data-emtf-tag]::after {
  content: attr(data-emtf-tag) !important; display: block !important; margin-top: 6px !important;
  color: #f9b4c0 !important; font: 600 11px/1.3 ${FONT} !important; letter-spacing: .02em !important;
}

/* ---------- Панель ---------- */
#emtf-toolbar {
  box-sizing: border-box !important; width: 100% !important; margin: 0 0 14px !important;
  border-radius: 11px !important; background: #313550 !important;
  border: 1px solid rgba(200, 207, 244, .10) !important; color: #e9edff !important;
  font-family: ${FONT} !important; font-size: 14px !important; line-height: 1.35 !important;
}
#emtf-toolbar[data-hidden="true"] { display: none !important; }
#emtf-toolbar * { box-sizing: border-box !important; font-family: inherit !important; }
#emtf-toolbar :is(button, select, input, label) { margin: 0 !important; text-transform: none !important; letter-spacing: normal !important; box-shadow: none !important; }
#emtf-toolbar .emtf-full {
  display: flex !important; flex-wrap: wrap !important; gap: 10px 18px !important;
  align-items: center !important; justify-content: space-between !important; padding: 12px 16px !important;
}
#emtf-toolbar .emtf-mini { display: none !important; }
#emtf-toolbar[data-collapsed="true"] .emtf-full { display: none !important; }
#emtf-toolbar[data-collapsed="true"] .emtf-mini {
  display: flex !important; flex-wrap: wrap !important; align-items: center !important;
  gap: 6px !important; padding: 6px 8px !important;
}
#emtf-toolbar .emtf-heading { display: flex !important; align-items: center !important; gap: 11px !important; }
#emtf-toolbar .emtf-icon {
  display: grid !important; place-items: center !important; background: #464c70 !important;
  color: #f9b4c0 !important; font-size: 21px !important; width: 34px !important;
  height: 34px !important; border-radius: 9px !important; flex: none !important;
}
#emtf-toolbar .emtf-heading-text { display: grid !important; gap: 1px !important; }
#emtf-toolbar .emtf-heading-text strong { font-size: 14px !important; font-weight: 650 !important; color: #f3f5ff !important; }
#emtf-toolbar .emtf-count { color: #adb9e0 !important; font-size: 12px !important; }
#emtf-toolbar .emtf-actions { display: flex !important; flex-wrap: wrap !important; gap: 8px !important; align-items: center !important; }
#emtf-toolbar .emtf-select, #emtf-toolbar .emtf-search {
  min-height: 34px !important; border-radius: 8px !important; color: #f4f6ff !important;
  border: 1px solid #606684 !important; background: #252a43 !important; font-size: 13px !important;
}
#emtf-toolbar .emtf-select { min-width: 132px !important; padding: 5px 26px 5px 10px !important; cursor: pointer !important; appearance: auto !important; }
#emtf-toolbar .emtf-search { width: 160px !important; padding: 5px 10px !important; outline: none !important; }
#emtf-toolbar .emtf-search::placeholder { color: #9aa7d0 !important; }
#emtf-toolbar .emtf-btn {
  min-height: 34px !important; border: 1px solid #5d6585 !important; background: #414864 !important;
  color: #f5f6ff !important; padding: 5px 11px !important; font-size: 13px !important;
  font-weight: 600 !important; border-radius: 8px !important; cursor: pointer !important; white-space: nowrap !important;
}
#emtf-toolbar .emtf-btn:hover { background: #50597c !important; }
#emtf-toolbar .emtf-btn[aria-pressed="false"] { background: transparent !important; color: #9aa4c8 !important; }
#emtf-toolbar .emtf-btn.square { width: 34px !important; padding: 0 !important; }
#emtf-toolbar .emtf-pill {
  min-height: 26px !important; padding: 2px 10px !important; border-radius: 13px !important;
  border: 1px solid #555c7d !important; background: transparent !important; color: #cdd5f2 !important;
  font-size: 12px !important; font-weight: 550 !important; cursor: pointer !important; white-space: nowrap !important;
}
#emtf-toolbar .emtf-pill:hover { background: #3d4363 !important; }
#emtf-toolbar .emtf-pill[aria-pressed="true"] { background: #ab4055 !important; border-color: #ab4055 !important; color: #fff !important; }
#emtf-toolbar .emtf-pill.icon { width: 26px !important; padding: 0 !important; }
#emtf-toolbar .emtf-mini .emtf-count { margin: 0 4px 0 auto !important; }
#emtf-toolbar :is(select, button, input):focus-visible { outline: 2px solid #ff8192 !important; outline-offset: 2px !important; }
@media (max-width: 640px) {
  #emtf-toolbar .emtf-actions { width: 100% !important; }
  #emtf-toolbar .emtf-actions :is(.emtf-select, .emtf-search) { min-width: 0 !important; flex: 1 !important; }
}

/* ---------- Компактные виды ---------- */
#emtf-view { box-sizing: border-box !important; margin: 0 0 16px !important; font-family: ${FONT} !important; color: #e9edff !important; }
#emtf-view[hidden] { display: none !important; }
#emtf-view * { box-sizing: border-box !important; font-family: inherit !important; }
#emtf-view .emtf-empty { color: #adb9e0 !important; font-size: 13px !important; padding: 12px 4px !important; }
#emtf-view .emtf-item {
  display: flex !important; flex-direction: column !important; justify-content: center !important; gap: 1px !important;
  min-width: 0 !important; padding: 7px 11px !important; border-radius: 8px !important;
  background: #323651 !important; border: 1px solid transparent !important; color: #eef1ff !important;
  text-decoration: none !important; text-align: left !important; cursor: pointer !important; font-size: 13px !important;
  margin: 0 !important; box-shadow: none !important; text-transform: none !important; letter-spacing: normal !important;
}
#emtf-view .emtf-item:hover { background: #3c4163 !important; border-color: #6b7397 !important; }
#emtf-view .emtf-item.pinned { border-color: rgba(249,180,192,.55) !important; }
#emtf-view .emtf-item-title { font-weight: 640 !important; white-space: nowrap !important; overflow: hidden !important; text-overflow: ellipsis !important; }
#emtf-view .emtf-item-sub { display: flex !important; gap: 8px !important; font-size: 11px !important; color: #a9b4d8 !important; white-space: nowrap !important; overflow: hidden !important; }
#emtf-view .emtf-item-tag { color: #f9b4c0 !important; font-weight: 600 !important; overflow: hidden !important; text-overflow: ellipsis !important; }
#emtf-view .emtf-star { color: #f9b4c0 !important; margin-right: 4px !important; }

/* Плитка: столько колонок, сколько влезает по ширине. */
#emtf-view[data-view="tiles"] .emtf-grid { display: grid !important; grid-template-columns: repeat(auto-fill, minmax(150px, 1fr)) !important; gap: 6px !important; }
#emtf-view[data-view="tiles"] .emtf-section + .emtf-section { margin-top: 10px !important; }
#emtf-view .emtf-section-title { color: #f9b4c0 !important; font-size: 11px !important; font-weight: 700 !important; letter-spacing: .08em !important; text-transform: uppercase !important; margin: 0 0 5px 2px !important; }

/* Строки: один проект — одна строка. */
#emtf-view[data-view="rows"] { display: grid !important; gap: 5px !important; }
/* Колонки: один проект — одна колонка, тенанты сверху вниз. */
#emtf-view[data-view="columns"] { display: grid !important; grid-template-columns: repeat(auto-fit, minmax(165px, 1fr)) !important; gap: 8px !important; align-items: start !important; }
#emtf-view[data-view="columns"] .emtf-row { grid-template-columns: 1fr !important; gap: 4px !important; padding: 6px !important; }
#emtf-view[data-view="columns"] .emtf-row-title { padding: 2px 4px 2px !important; }
#emtf-view[data-view="columns"] .emtf-row-items { flex-direction: column !important; flex-wrap: nowrap !important; }
#emtf-view[data-view="columns"] .emtf-item { padding: 6px 10px !important; }
/* Перетаскивание */
#emtf-view .emtf-item[draggable="true"] { cursor: grab !important; }
#emtf-view .emtf-item.dragging { opacity: .4 !important; }
#emtf-view .emtf-item.drop-before { box-shadow: inset 3px 0 0 #f9b4c0 !important; }
#emtf-view .emtf-item.drop-after { box-shadow: inset -3px 0 0 #f9b4c0 !important; }
#emtf-view[data-orient="v"] .emtf-item.drop-before { box-shadow: inset 0 3px 0 #f9b4c0 !important; }
#emtf-view[data-orient="v"] .emtf-item.drop-after { box-shadow: inset 0 -3px 0 #f9b4c0 !important; }
#emtf-view [data-drop].drop-end { outline: 1px dashed #f9b4c0 !important; outline-offset: 2px !important; border-radius: 8px !important; }
#emtf-view .emtf-row-items:empty::before { content: 'Перетащите сюда' !important; color: #6f789c !important; font-size: 12px !important; padding: 6px 4px !important; }
#emtf-view .emtf-row { display: grid !important; grid-template-columns: 110px minmax(0, 1fr) !important; gap: 8px !important; align-items: start !important; padding: 5px 6px !important; border-radius: 9px !important; background: rgba(49,53,80,.55) !important; }
#emtf-view .emtf-row-title { padding: 7px 4px 0 !important; color: #f9b4c0 !important; font-size: 12px !important; font-weight: 700 !important; overflow: hidden !important; text-overflow: ellipsis !important; white-space: nowrap !important; }
#emtf-view .emtf-row-title small { color: #8f9abf !important; font-weight: 500 !important; margin-left: 4px !important; }
#emtf-view .emtf-row-items { display: flex !important; flex-wrap: wrap !important; gap: 5px !important; }
#emtf-view[data-view="rows"] .emtf-item { padding: 5px 10px !important; }

/* Список: строки в несколько колонок, чтобы всё влезло на экран. */
#emtf-view[data-view="list"] .emtf-grid { columns: 3 280px !important; column-gap: 10px !important; }
#emtf-view[data-view="list"] .emtf-item {
  flex-direction: row !important; align-items: center !important; gap: 10px !important; width: 100% !important;
  padding: 5px 10px !important; margin: 0 0 4px !important; break-inside: avoid !important;
}
#emtf-view[data-view="list"] .emtf-item-title { flex: 1 !important; }
#emtf-view[data-view="list"] .emtf-item-sub { flex: none !important; }
@media (max-width: 640px) { #emtf-view .emtf-row { grid-template-columns: 1fr !important; } }
`;
  (document.head || document.documentElement).append(pageStyle);

  /* ======================= Фильтр на странице (бывший content.js) ======================= */

  const cardLines = new WeakMap();
  let lastStoredFingerprint = state.seen.map(normalizeTitle).sort().join('|');
  let cards = [];
  let currentGrid = null;
  let toolbar = null;
  let viewBox = null;
  let refreshTimer = 0;
  const ui = {}; // ссылки на элементы панели

  function create(tag, className, text) {
    const el = document.createElement(tag);
    if (className) el.className = className;
    if (typeof text === 'string') el.textContent = text;
    return el;
  }

  // Строки текста карточки: название, адрес Chatwoot, ID аккаунта.
  // Работает и когда карточка скрыта (компактные виды прячут сетку сайта).
  function linesOf(card) {
    if (cardLines.has(card)) return cardLines.get(card);
    let lines = [];
    if (card.getClientRects().length) {
      lines = (card.innerText || '').split(/\r?\n/).map(item => item.trim()).filter(Boolean);
    }
    if (lines.length <= 1) {
      const walker = document.createTreeWalker(card, NodeFilter.SHOW_TEXT);
      const fromNodes = [];
      while (walker.nextNode()) {
        const text = walker.currentNode.nodeValue.trim().replace(/\s+/g, ' ');
        if (text) fromNodes.push(text);
      }
      if (fromNodes.length > lines.length) lines = fromNodes;
    }
    if (lines.length && cleanName(lines[0]).length <= 120) cardLines.set(card, lines);
    return lines;
  }

  const titleOf = card => cleanName(linesOf(card)[0] || '');
  const accountOf = card => linesOf(card).slice(1).reverse().find(line => /^\d{3,}$/.test(line)) || '';

  function isTenantListing() {
    if (document.querySelector('[data-emtf-demo="true"]')) return true; // только локальный тест
    if (hasTenantContext()) return false;

    const controls = document.querySelectorAll('button, a, [role="button"]');
    for (const node of controls) {
      if (node.closest('#emtf-toolbar, #emtf-view')) continue;
      const text = (node.textContent || '').trim();
      if (/^(create new (tenant|product)|создать (нов(ый|ого) )?(тенант|продукт))/i.test(text)) return true;
    }

    const p = location.pathname.replace(/\/+$/, '') || '/';
    return /^\/(tenants?|products?|dashboard)?$/i.test(p);
  }

  function knownTitles() {
    return new Set([
      ...state.seen,
      ...state.config.groups.flatMap(group => group.tenants)
    ].map(normalizeTitle));
  }

  function findGrid() {
    if (!isTenantListing()) return null;
    const known = knownTitles();
    let best = null;
    let bestScore = -Infinity;
    const containers = document.querySelectorAll('div, section, main, ul');

    for (const container of containers) {
      if (container.closest('#emtf-toolbar, #emtf-view')) continue;
      if (container.closest('form, [role="tabpanel"], .accordion, [class*="prompt"], [class*="accordion"]')) continue;

      const children = [...container.children].filter(node =>
        node instanceof HTMLElement && !['emtf-toolbar', 'emtf-view'].includes(node.id) &&
        !['SCRIPT', 'STYLE', 'TEMPLATE'].includes(node.tagName)
      );
      if (children.length < 3 || children.length > 180) continue;

      let plausible = 0;
      let matches = 0;
      let urls = 0;
      let longCards = 0;
      for (const child of children) {
        const title = titleOf(child);
        const body = child.textContent || '';
        if (title && title.length < 100 && body.length < 700 &&
            !/^(create new (tenant|product)|создать (тенант|продукт))$/i.test(title) &&
            !child.querySelector('input, form, textarea')) plausible++;
        if (known.has(normalizeTitle(title))) matches++;
        if (/https?:\/\/app\.chatwoot\.com/i.test(body)) urls++;
        if (body.length > 700) longCards++;
      }
      if (plausible < 3 || longCards > 1) continue;

      // Нужны подтвержденные совпадения названий тенантов из настроек
      if (matches < 2) continue;
      const style = getComputedStyle(container);
      const hasGridLayout = container.dataset.emtfOff === 'true' || style.display === 'grid' ||
        (style.display === 'flex' && style.flexWrap !== 'nowrap') ||
        /grid/i.test(String(container.className));
      const score = matches * 7 + urls * 5 + plausible +
        (hasGridLayout ? 18 : 0) - (children.length - plausible) * 6 - longCards * 9;
      if (score > bestScore) {
        bestScore = score;
        best = { container, children };
      }
    }
    return best;
  }

  // Сайт оборачивает карточку в лишний блок — подпись ставим внутрь самой карточки.
  const tagTarget = card => (card.children.length === 1 ? card.firstElementChild : card);

  function resetCard(card) {
    delete card.dataset.emtfHidden;
    delete card.dataset.emtfPinned;
    delete card.dataset.emtfTag;
    delete tagTarget(card).dataset.emtfTag;
    delete tagTarget(card).dataset.emtfPinned;
    card.style.removeProperty('order');
  }

  function resetGrid() {
    cards.forEach(resetCard);
    if (currentGrid) delete currentGrid.dataset.emtfOff;
  }

  function setUi(patch) {
    saveConfig({ ...state.config, ui: { ...state.config.ui, ...patch } });
  }

  function makeSelect(id, entries, onChange) {
    const select = create('select', 'emtf-select');
    select.id = id;
    for (const [value, text] of entries) {
      const option = create('option', '', text);
      option.value = value;
      select.append(option);
    }
    select.addEventListener('change', () => onChange(select.value));
    return select;
  }

  function makeButton(className, text, title, onClick) {
    const button = create('button', className, text);
    button.type = 'button';
    button.title = title;
    button.addEventListener('click', onClick);
    return button;
  }

  function ensureToolbar(grid) {
    if (!toolbar) {
      toolbar = create('section', 'emtf-toolbar');
      toolbar.id = 'emtf-toolbar';
      toolbar.setAttribute('aria-label', 'Фильтр тенантов EchoMind');

      // Полная панель.
      const full = create('div', 'emtf-full');
      const heading = create('div', 'emtf-heading');
      heading.append(create('span', 'emtf-icon', '◈'));
      const headingText = create('div', 'emtf-heading-text');
      ui.count = create('span', 'emtf-count');
      ui.count.setAttribute('aria-live', 'polite');
      headingText.append(create('strong', '', 'Проекты'), ui.count);
      heading.append(headingText);

      const actions = create('div', 'emtf-actions');
      ui.project = makeSelect('emtf-project-select', [], value =>
        saveConfig({ ...state.config, selected: value }));
      ui.project.title = 'Проект';
      ui.sort = makeSelect('emtf-sort-select', Object.entries(SORTS), value =>
        saveConfig({ ...state.config, sort: value }));
      ui.sort.title = 'Сортировка';
      ui.view = makeSelect('emtf-view-select', Object.entries(VIEWS), value => setUi({ view: value }));
      ui.view.title = 'Вид';
      ui.search = create('input', 'emtf-search');
      ui.search.type = 'search';
      ui.search.placeholder = 'Поиск тенанта';
      ui.search.autocomplete = 'off';
      ui.search.addEventListener('input', applyView);
      ui.search.addEventListener('keydown', event => {
        if (event.key === 'Escape') {
          ui.search.value = '';
          applyView();
        }
      });
      ui.tags = makeButton('emtf-btn', 'Подписи', 'Показывать названия проектов на карточках',
        () => setUi({ showTags: !state.config.ui.showTags }));
      const settings = makeButton('emtf-btn emtf-settings', '⚙', 'Настроить проекты и тенанты', () => editor.open());
      settings.classList.add('square');
      const collapse = makeButton('emtf-btn square', '▴', 'Свернуть панель в строку (Alt+P)',
        () => setUi({ collapsed: true }));
      actions.append(ui.project, ui.sort, ui.view, ui.search, ui.tags, settings, collapse);
      full.append(heading, actions);

      // Свёрнутая панель: одна тонкая строка с проектами.
      const mini = create('div', 'emtf-mini');
      ui.pills = create('div', 'emtf-actions');
      ui.miniCount = create('span', 'emtf-count');
      const expand = makeButton('emtf-pill icon', '▾', 'Развернуть панель (Alt+P)', () => setUi({ collapsed: false }));
      const miniSettings = makeButton('emtf-pill icon', '⚙', 'Настроить проекты', () => editor.open());
      const hide = makeButton('emtf-pill icon', '✕', 'Скрыть панель полностью (вернуть: Alt+P или меню Tampermonkey)',
        () => setUi({ hidden: true }));
      mini.append(ui.pills, ui.miniCount, miniSettings, expand, hide);

      toolbar.append(full, mini);
    }
    if (toolbar.parentElement !== grid.parentElement || toolbar.nextElementSibling !== (viewBox || grid)) {
      grid.parentElement.insertBefore(toolbar, grid);
    }
    if (!viewBox) {
      viewBox = create('div');
      viewBox.id = 'emtf-view';
      setupDrag(viewBox);
    }
    if (viewBox.previousElementSibling !== toolbar || viewBox.nextElementSibling !== grid) {
      grid.parentElement.insertBefore(viewBox, grid);
    }
    updateControls();
  }

  function updateControls() {
    if (!toolbar) return;
    const { config } = state;
    toolbar.dataset.collapsed = String(config.ui.collapsed);
    toolbar.dataset.hidden = String(config.ui.hidden);

    const desired = [
      { id: ALL, label: 'Все проекты' },
      ...config.groups.map(group => ({ id: group.id, label: group.name })),
      { id: UNASSIGNED, label: 'Без группы' }
    ];
    const signature = desired.map(item => `${item.id}:${item.label}`).join('|');
    if (ui.project.dataset.signature !== signature) {
      ui.project.replaceChildren();
      ui.pills.replaceChildren();
      for (const item of desired) {
        const option = create('option', '', item.label);
        option.value = item.id;
        ui.project.append(option);
        const pill = makeButton('emtf-pill', item.id === ALL ? 'Все' : item.label, item.label,
          () => saveConfig({ ...state.config, selected: item.id }));
        pill.dataset.id = item.id;
        ui.pills.append(pill);
      }
      ui.project.dataset.signature = signature;
    }
    ui.project.value = config.selected;
    for (const pill of ui.pills.children) {
      pill.setAttribute('aria-pressed', String(pill.dataset.id === config.selected));
    }
    ui.sort.value = config.sort;
    ui.view.value = config.ui.view;
    ui.tags.setAttribute('aria-pressed', String(config.ui.showTags));
  }

  // Кликабельный элемент карточки сайта — чтобы компактные виды открывали тенант так же.
  function cardLink(card) {
    return card.matches('a[href]') ? card : card.querySelector('a[href]');
  }

  function activateCard(card) {
    const candidates = [card, ...card.querySelectorAll('*')];
    const target = candidates.find(node => getComputedStyle(node).cursor === 'pointer') ||
      tagTarget(card);
    target.click();
  }

  function renderItem(entry, showTag, bucket = '') {
    const { config } = state;
    const link = cardLink(entry.card);
    const item = create(link ? 'a' : 'button', 'emtf-item');
    if (link) {
      item.href = link.href;
      if (link.target) item.target = link.target;
      item.rel = link.rel || '';
    } else {
      item.type = 'button';
      item.addEventListener('click', () => activateCard(entry.card));
    }
    if (entry.pinned) item.classList.add('pinned');
    item.draggable = true;
    item.dataset.title = entry.title;
    item.dataset.bucket = bucket;
    item.title = [entry.title, entry.account && `ID ${entry.account}`].filter(Boolean).join(' · ');

    const title = create('span', 'emtf-item-title');
    if (entry.pinned) title.append(create('span', 'emtf-star', '★'));
    title.append(entry.title);
    item.append(title);

    const sub = create('span', 'emtf-item-sub');
    if (entry.account) sub.append(create('span', '', entry.account));
    if (showTag && config.ui.showTags) {
      const names = groupIds(config, entry.title)
        .map(id => config.groups.find(group => group.id === id)?.name).filter(Boolean);
      sub.append(create('span', 'emtf-item-tag', names.length ? names.join(' · ') : 'Без группы'));
    }
    if (sub.childNodes.length) item.append(sub);
    return item;
  }

  function renderCompact(view, visibleEntries) {
    const { config } = state;
    viewBox.dataset.view = view;
    viewBox.dataset.orient = view === 'list' || view === 'columns' ? 'v' : 'h';
    viewBox.replaceChildren();
    if (!visibleEntries.length) {
      viewBox.append(create('div', 'emtf-empty', 'Ничего не найдено.'));
      return;
    }

    if (view === 'rows' || view === 'columns') {
      // Каждый проект — своя строка (или колонка); тенант из двух проектов виден в обоих.
      const buckets = [
        ...config.groups.map(group => ({ id: group.id, name: group.name })),
        { id: UNASSIGNED, name: 'Без группы' }
      ];
      for (const bucket of buckets) {
        if (config.selected !== ALL && config.selected !== bucket.id) continue;
        const members = visibleEntries.filter(entry => {
          const ids = groupIds(config, entry.title);
          return bucket.id === UNASSIGNED ? ids.length === 0 : ids.includes(bucket.id);
        });
        // Пустой проект тоже показываем, чтобы в него можно было перетащить тенант.
        if (!members.length && (bucket.id === UNASSIGNED || ui.search?.value)) continue;
        const row = create('div', 'emtf-row');
        const label = create('div', 'emtf-row-title', bucket.name);
        label.title = bucket.name;
        label.append(create('small', '', String(members.length)));
        const items = create('div', 'emtf-row-items');
        items.dataset.drop = bucket.id;
        members.forEach(entry => items.append(renderItem(entry, false, bucket.id)));
        row.append(label, items);
        viewBox.append(row);
      }
      return;
    }

    // Плитка и список: при сортировке по проектам — с заголовками разделов.
    const grouped = view === 'tiles' && config.sort === 'project' && config.selected === ALL;
    if (!grouped) {
      const grid = create('div', 'emtf-grid');
      grid.dataset.drop = '';
      visibleEntries.forEach(entry => grid.append(renderItem(entry, config.selected === ALL)));
      viewBox.append(grid);
      return;
    }
    let section = null;
    let lastRank = null;
    for (const entry of visibleEntries) {
      const rank = entry.pinned ? -1 : groupRank(config, entry.title);
      if (rank !== lastRank) {
        lastRank = rank;
        section = create('div', 'emtf-section');
        const name = rank === -1 ? '★ Закреплённые'
          : config.groups[rank]?.name ?? 'Без группы';
        const grid = create('div', 'emtf-grid');
        grid.dataset.drop = rank === -1 ? 'pinned' : (config.groups[rank]?.id ?? UNASSIGNED);
        section.append(create('div', 'emtf-section-title', name), grid);
        viewBox.append(section);
      }
      section.lastElementChild.append(renderItem(entry, false, section.lastElementChild.dataset.drop));
    }
  }

  /* ---------- Перетаскивание тенантов в компактных видах ---------- */

  let dragged = null;

  function clearDropMarks() {
    viewBox?.querySelectorAll('.drop-before, .drop-after, .drop-end')
      .forEach(node => node.classList.remove('drop-before', 'drop-after', 'drop-end'));
  }

  // Куда упадёт тенант: перед/после элемента под курсором или в конец группы.
  function dropTarget(event) {
    const container = event.target.closest?.('[data-drop]');
    if (!container || !viewBox.contains(container)) return null;
    const vertical = viewBox.dataset.orient === 'v';
    let item = event.target.closest('.emtf-item');
    if (item && !container.contains(item)) item = null;
    if (!item) {
      // Ближайший элемент группы по положению курсора.
      const items = [...container.querySelectorAll('.emtf-item')];
      item = items.find(node => {
        const rect = node.getBoundingClientRect();
        return vertical ? event.clientY < rect.bottom : (event.clientY < rect.bottom && event.clientX < rect.right);
      }) || null;
      if (!item) return { container, item: null, after: true };
    }
    const rect = item.getBoundingClientRect();
    const after = vertical
      ? event.clientY > rect.top + rect.height / 2
      : event.clientX > rect.left + rect.width / 2;
    return { container, item, after };
  }

  function applyDrop(target) {
    const { config } = state;
    const title = dragged.title;
    const key = normalizeTitle(title);
    // Текущий порядок на экране (без повторов) → переставляем перетащенный тенант.
    const order = [];
    for (const node of viewBox.querySelectorAll('.emtf-item')) {
      const name = node.dataset.title;
      if (!order.some(item => normalizeTitle(item) === normalizeTitle(name))) order.push(name);
    }
    const without = order.filter(item => normalizeTitle(item) !== key);
    let index;
    if (target.item) {
      index = without.findIndex(item => normalizeTitle(item) === normalizeTitle(target.item.dataset.title));
      if (index === -1) index = without.length;
      else if (target.after) index++;
    } else {
      const last = [...target.container.querySelectorAll('.emtf-item')]
        .map(node => node.dataset.title).filter(name => normalizeTitle(name) !== key).pop();
      index = last ? without.findIndex(item => normalizeTitle(item) === normalizeTitle(last)) + 1 : without.length;
    }
    without.splice(index, 0, title);
    const rest = config.order.filter(item => !without.some(name => normalizeTitle(name) === normalizeTitle(item)));
    let next = { ...config, order: [...without, ...rest] };
    if (config.sort === 'site' || config.sort === 'alpha') next.sort = 'manual';

    // Перенос в другой проект: убираем из исходного, добавляем в новый (остальные проекты не трогаем).
    const from = dragged.bucket;
    const to = target.container.dataset.drop;
    if (from && to && from !== to && from !== 'pinned' && to !== 'pinned') {
      if (from !== UNASSIGNED) next = setMembership(next, title, from, false);
      if (to !== UNASSIGNED) next = setMembership(next, title, to, true);
      else next = clearMemberships(next, title);
      saveSeen([...state.seen, title]);
    }
    saveConfig(next);
  }

  function setupDrag(box) {
    box.addEventListener('dragstart', event => {
      const item = event.target.closest?.('.emtf-item');
      if (!item) return;
      dragged = { title: item.dataset.title, bucket: item.dataset.bucket };
      event.dataTransfer.effectAllowed = 'move';
      event.dataTransfer.setData('text/plain', item.dataset.title);
      requestAnimationFrame(() => item.classList.add('dragging'));
    });
    box.addEventListener('dragover', event => {
      if (!dragged) return;
      const target = dropTarget(event);
      clearDropMarks();
      if (!target) return;
      event.preventDefault();
      event.dataTransfer.dropEffect = 'move';
      if (target.item) target.item.classList.add(target.after ? 'drop-after' : 'drop-before');
      else target.container.classList.add('drop-end');
    });
    box.addEventListener('drop', event => {
      if (!dragged) return;
      const target = dropTarget(event);
      clearDropMarks();
      if (!target) return;
      event.preventDefault();
      if (target.item?.dataset.title === dragged.title && target.item.dataset.bucket === dragged.bucket) return;
      applyDrop(target);
    });
    box.addEventListener('dragend', () => {
      dragged = null;
      clearDropMarks();
      box.querySelectorAll('.dragging').forEach(node => node.classList.remove('dragging'));
    });
  }

  // Фильтрация + сортировка + выбранный вид.
  function applyView() {
    if (!currentGrid) return;
    const { config } = state;
    const view = config.ui.view;
    const query = normalizeTitle(ui.search?.value || '');
    const groupNames = new Map(config.groups.map(group => [group.id, group.name]));
    const entries = cards.map((card, index) => {
      const title = titleOf(card);
      return {
        card, index, title, account: accountOf(card), pinned: isPinned(config, title),
        show: belongsTo(config, title) && (!query || normalizeTitle(title).includes(query))
      };
    });
    const sorted = entries.slice().sort((a, b) => compareEntries(config, a, b));
    const visible = sorted.filter(entry => entry.show);

    if (view === 'site') {
      delete currentGrid.dataset.emtfOff;
      viewBox.hidden = true;
      viewBox.replaceChildren();
      const needOrder = config.sort !== 'site' || entries.some(entry => entry.pinned);
      for (const entry of entries) {
        if (entry.show) delete entry.card.dataset.emtfHidden;
        else entry.card.dataset.emtfHidden = 'true';

        const target = tagTarget(entry.card);
        if (entry.pinned) target.dataset.emtfPinned = 'true';
        else delete target.dataset.emtfPinned;

        const parts = [];
        if (entry.pinned) parts.push('★');
        if (config.ui.showTags && config.sort === 'project' && config.selected === ALL) {
          const names = groupIds(config, entry.title).map(id => groupNames.get(id));
          parts.push(names.length ? names.join(' · ') : 'Без группы');
        }
        if (parts.length) target.dataset.emtfTag = parts.join(' ');
        else delete target.dataset.emtfTag;
      }
      sorted.forEach((entry, position) => {
        if (needOrder) entry.card.style.setProperty('order', String(position));
        else entry.card.style.removeProperty('order');
      });
    } else {
      cards.forEach(resetCard);
      currentGrid.dataset.emtfOff = 'true';
      viewBox.hidden = false;
      renderCompact(view, visible);
    }

    const counter = `Показано ${visible.length} из ${cards.length}`;
    if (ui.count) ui.count.textContent = cards.length ? counter : 'Карточки не найдены';
    if (ui.miniCount) ui.miniCount.textContent = `${visible.length}/${cards.length}`;
  }

  function saveSeenTitles() {
    const newSeen = cleanSeen([...state.seen, ...cards.map(titleOf)]);
    const fingerprint = newSeen.map(normalizeTitle).sort().join('|');
    if (fingerprint === lastStoredFingerprint) return;
    lastStoredFingerprint = fingerprint;
    saveSeen(newSeen);
  }

  function refresh() {
    const result = findGrid();
    if (!result) {
      resetGrid();
      cards = [];
      currentGrid = null;
      if (toolbar) {
        toolbar.remove();
        toolbar = null;
      }
      if (viewBox) {
        viewBox.remove();
        viewBox = null;
      }
      document.querySelectorAll('#emtf-toolbar, #emtf-view').forEach(el => el.remove());
      return;
    }
    if (currentGrid !== result.container) resetGrid();
    currentGrid = result.container;
    cards = result.children;
    ensureToolbar(currentGrid);
    applyView();
    saveSeenTitles();
  }

  function scheduleRefresh() {
    if (refreshTimer) clearTimeout(refreshTimer);
    refreshTimer = setTimeout(() => {
      refreshTimer = 0;
      refresh();
    }, 150);
  }

  listeners.add(() => {
    lastStoredFingerprint = state.seen.map(normalizeTitle).sort().join('|');
    updateControls();
    applyView();
  });

  // Alt+P: развернуть ↔ свернуть панель; если была скрыта полностью — показать.
  function togglePanel() {
    const current = state.config.ui;
    if (current.hidden) setUi({ hidden: false, collapsed: false });
    else setUi({ collapsed: !current.collapsed });
  }

  document.addEventListener('keydown', event => {
    if (event.altKey && !event.ctrlKey && !event.metaKey && event.code === 'KeyP') {
      event.preventDefault();
      togglePanel();
    }
  });

  /* ======================= Окно настроек (бывшие options.*) ======================= */

  const EDITOR_CSS = `
:host { all: initial; }
.overlay {
  color-scheme: dark;
  --bg: #23263b; --panel: #30344e; --panel-2: #292d45; --border: #454c6b;
  --text: #f0f2ff; --muted: #a9b4d8; --accent: #ed3e51; --focus: #ff91a0;
  position: fixed; inset: 0; z-index: 2147483646; overflow: auto; overscroll-behavior: contain;
  background: var(--bg); color: var(--text);
  font: 14px/1.5 Inter, system-ui, -apple-system, 'Segoe UI', sans-serif; min-width: 320px;
}
* { box-sizing: border-box; }
.app-shell { width: min(1250px, calc(100% - 44px)); margin: 0 auto; padding: 38px 0 30px; }
.app-header { display: flex; gap: 17px; align-items: flex-start; margin-bottom: 29px; }
.brand-mark { flex: 0 0 53px; height: 53px; border-radius: 13px; display: grid; place-items: center; color: #ffc2ca; background: #3d415d; font-size: 34px; }
.heading-content { flex: 1; min-width: 0; }
.eyebrow { color: #b9c5e9; font-size: 10px; font-weight: 750; letter-spacing: .13em; }
h1,h2,p { margin: 0; }
h1 { font-size: clamp(22px, 3.1vw, 30px); letter-spacing: -.025em; line-height: 1.25; font-weight: 750; margin: 4px 0 7px; }
.app-header p { color: var(--muted); max-width: 630px; }
.header-actions { margin-left: auto; display: flex; flex-direction: column; align-items: flex-end; gap: 12px; flex: 0 0 auto; }
.header-buttons { display: flex; gap: 8px; flex-wrap: wrap; justify-content: flex-end; }
.back-button { border: 1px solid #6a7295; background: #39415c; color: #f3f5ff; border-radius: 9px; padding: 9px 13px; min-height: 42px; font-size: 13px; font-weight: 650; }
.back-button:hover { background: #4a5475; }
.back-button.subtle { background: transparent; border-color: #535a7a; color: #cfd6f3; font-weight: 550; }
.back-button.subtle:hover { background: #343a55; }
.privacy-badge { margin-top: 7px; color: #b3e8ce; background: #28483f; padding: 7px 12px; border-radius: 50px; font-size: 12px; white-space: nowrap; }
.stats { display: grid; grid-template-columns: repeat(4,minmax(0,1fr)); gap: 12px; margin-bottom: 18px; }
.stat { padding: 16px 20px; background: var(--panel); border: 1px solid #3b405d; border-radius: 12px; display: flex; justify-content: space-between; align-items: center; gap: 12px; }
.stat span { color: var(--muted); font-size: 13px; }
.stat strong { font-size: 23px; font-weight: 750; font-variant-numeric: tabular-nums; }
.workspace { display: grid; grid-template-columns: 270px minmax(0,1fr); gap: 17px; align-items: start; }
.sidebar,.main-panel { background: var(--panel); border: 1px solid #3e4462; border-radius: 15px; min-width: 0; }
.sidebar { padding: 20px 14px; }
.sidebar-title { padding: 0 9px 15px; display: flex; justify-content: space-between; align-items: center; }
.sidebar h2,.main-panel h2 { font-size: 17px; letter-spacing: -.02em; }
.count-pill { font-size: 11px; padding: 3px 7px; border-radius: 9px; background: #454b69; color: #d2d9f4; }
.group-list { display: grid; gap: 4px; }
.group-row { display: flex; align-items: center; gap: 2px; }
.group-item { width: 100%; border: 1px solid transparent; cursor: pointer; background: transparent; border-radius: 9px; text-align: left; padding: 10px 12px; display: flex; align-items: center; gap: 9px; color: #d7ddf5; font: inherit; font-weight: 570; }
.group-item:hover { background: #3b405d; }
.group-item.active { color: #fff; background: #48435f; border-color: #7b5976; }
.group-icon { display: grid; place-items: center; border-radius: 7px; height: 25px; width: 25px; background: #444a6b; color: #d0d9f7; font-size: 15px; flex: 0 0 auto; }
.group-item.active .group-icon { background: #ab4055; color: #fff; }
.group-item .group-name { flex: 1; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.group-item .group-number { color: #b9c5e9; font-size: 12px; font-variant-numeric: tabular-nums; }
.move-button { flex: 0 0 22px; height: 22px; padding: 0; border: 0; border-radius: 5px; background: transparent; color: #8e98bd; font-size: 11px; line-height: 1; }
.move-button:hover:not(:disabled) { background: #3b405d; color: #fff; }
.move-button:disabled { opacity: .25; cursor: default; }
.add-form { border-top: 1px solid #4a4f6d; margin: 20px 5px 0; padding-top: 18px; }
.add-form label,.manual-add label { display: block; margin-bottom: 9px; font-size: 12px; font-weight: 660; color: #e9ebfa; }
.field-inline { display: flex; gap: 8px; align-items: stretch; }
input, select, button { font: inherit; }
input { min-height: 39px; background: #242840; border: 1px solid #565d7c; border-radius: 8px; padding: 9px 11px; color: #f4f6ff; min-width: 0; outline: none; }
input::placeholder { color: #9aa7d0; }
.field-inline input { width: 100%; flex: 1; }
button { cursor: pointer; }
button:focus-visible, input:focus-visible, select:focus-visible { outline: 3px solid var(--focus); outline-offset: 2px; }
.add-form .field-inline { flex-direction: column; align-items: stretch; gap: 9px; }
.primary-button { display: flex; align-items: center; justify-content: center; width: 100%; min-height: 40px; padding: 9px 12px; font-size: 13px; font-weight: 700; line-height: 1.3; text-align: center; background: var(--accent); border: 0; color: #fff; border-radius: 8px; }
.primary-button:hover { background: #ff5163; }
.main-panel { overflow: hidden; }
.panel-header { display: flex; justify-content: space-between; gap: 16px; align-items: center; padding: 22px 24px; border-bottom: 1px solid var(--border); }
.panel-header h2 { font-size: 19px; margin: 3px 0 4px; }
.panel-header p { font-size: 12px; color: var(--muted); }
.group-actions { display: flex; flex-wrap: wrap; gap: 7px; }
.group-actions[hidden] { display: none; }
.ghost-button,.danger-button,.secondary-button { border: 1px solid #596180; color: #edf0ff; background: #3c435f; border-radius: 8px; padding: 8px 12px; font-size: 12px; font-weight: 650; min-height: 39px; }
.ghost-button:hover,.secondary-button:hover { background: #505a7c; }
.danger-button { border-color: #8a5262; color: #ffc7cf; background: #594051; }
.danger-button:hover { background: #774657; }
.toolbar { padding: 17px 24px; display: flex; align-items: center; justify-content: space-between; gap: 12px; }
.search-wrap { flex: 1; max-width: 390px; position: relative; display: flex; align-items: center; }
.search-wrap > span { position: absolute; left: 13px; color: #b2bfe3; font-size: 22px; pointer-events: none; }
.search-wrap input { padding-left: 36px; width: 100%; }
.hint { color: #b8c3e4; font-size: 11px; }
.list-heading,.tenant-row { display: grid; grid-template-columns: minmax(0,1fr) minmax(170px,240px); gap: 20px; align-items: center; }
.list-heading { background: var(--panel-2); padding: 10px 24px; text-transform: uppercase; letter-spacing: .1em; font-size: 10px; font-weight: 750; color: #b6c2e4; }
.tenant-list { max-height: 505px; overflow: auto; }
.tenant-row { min-height: 59px; padding: 10px 24px; border-bottom: 1px solid #444960; }
.tenant-row:last-child { border-bottom: 0; }
.tenant-details { min-width: 0; display: flex; align-items: flex-start; gap: 10px; }
.tenant-text { min-width: 0; }
.tenant-name { font-size: 13px; font-weight: 640; overflow-wrap: anywhere; }
.tenant-meta { font-size: 11px; font-weight: 450; color: #aebcdd; margin-top: 2px; overflow-wrap: anywhere; }
.pin-button { flex: 0 0 26px; height: 26px; padding: 0; margin-top: 1px; border: 1px solid transparent; border-radius: 7px; background: transparent; color: #6f789c; font-size: 15px; line-height: 1; }
.pin-button:hover { background: #3b405d; color: #f9b4c0; }
.pin-button[aria-pressed="true"] { color: #f9b4c0; }
.membership-trigger { min-width: 0; width: 100%; min-height: 39px; display: flex; align-items: center; gap: 8px; background: #282c46; border: 1px solid #626b8d; border-radius: 8px; color: #f3f5ff; text-align: left; padding: 8px 10px; }
.membership-trigger:hover,.membership-trigger[aria-expanded="true"] { background: #373d60; border-color: #9a86b9; }
.membership-label { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-size: 12px; }
.membership-count { flex: 0 0 auto; min-width: 21px; height: 21px; display: grid; place-items: center; background: #454b6b; border-radius: 6px; font-size: 11px; font-variant-numeric: tabular-nums; color: #dfe5ff; }
.membership-chevron { flex: 0 0 auto; height: 7px; width: 7px; border-right: 1.5px solid #c6cce6; border-bottom: 1.5px solid #c6cce6; transform: rotate(45deg) translateY(-2px); }
.membership-trigger[aria-expanded="true"] .membership-chevron { transform: rotate(225deg) translateY(-1px); }
.membership-panel { grid-column: 1 / -1; min-width: 0; padding: 14px; border: 1px solid #545a7a; background: #272c46; border-radius: 10px; }
.membership-intro { display: grid; gap: 2px; margin-bottom: 12px; }
.membership-intro strong { font-size: 13px; font-weight: 670; }
.membership-intro span { font-size: 11px; color: #bac6eb; }
.membership-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(150px, 1fr)); gap: 7px; max-height: 212px; overflow: auto; }
.membership-choice { display: flex; align-items: center; gap: 10px; min-width: 0; min-height: 39px; border: 1px solid #505776; background: #333954; border-radius: 8px; padding: 7px 10px; cursor: pointer; color: #eff2ff; font-size: 12px; }
.membership-choice:hover { background: #414865; }
.membership-choice:has(input:checked) { border-color: #c5738c; background: #49405b; }
.membership-choice input { margin: 0; padding: 0; width: 17px; height: 17px; min-height: 0; flex: 0 0 17px; accent-color: #f04a61; cursor: pointer; }
.membership-choice span { min-width: 0; overflow-wrap: anywhere; }
.membership-empty { font-size: 12px; color: #bac6eb; }
.membership-actions { display: flex; flex-wrap: wrap; justify-content: flex-end; gap: 8px; margin-top: 12px; }
.membership-clear,.membership-done { min-height: 35px; padding: 7px 12px; border: 1px solid #626a8b; border-radius: 8px; font-size: 12px; color: #eef1ff; background: #404866; }
.membership-clear:hover:not(:disabled) { background: #505977; }
.membership-clear:disabled { opacity: .5; cursor: default; }
.membership-done { background: #ed3e51; border-color: #ed3e51; font-weight: 650; }
.membership-done:hover { background: #ff5163; }
.empty-state { display: grid; justify-items: center; gap: 5px; color: #bbc6e8; padding: 50px 18px; text-align: center; }
.empty-state[hidden] { display: none; }
.empty-icon { font-size: 33px; color: #c5c9f8; }
.empty-state strong { color: #eef1ff; font-size: 15px; }
.empty-state p { font-size: 12px; }
.manual-add { padding: 21px 24px 24px; border-top: 1px solid var(--border); background: #2d314a; }
.manual-add p { color: #acb8d8; font-size: 12px; margin: -5px 0 13px; }
.manual-add input { max-width: 340px; }
.secondary-button { white-space: nowrap; }
footer { color: #a6b2d8; font-size: 12px; text-align: center; margin: 22px 0 0; }
.toast { position: fixed; right: 24px; bottom: 22px; background: #485b56; border: 1px solid #668e7f; color: #effff7; padding: 11px 15px; box-shadow: 0 8px 28px #12162b6e; border-radius: 10px; font-size: 13px; z-index: 1000; }
.toast[hidden] { display: none; }
.toast.error { background: #683d4a; border-color: #ab5e70; }
@media (max-width: 920px) {
  .workspace { grid-template-columns: 215px minmax(0,1fr); }
  .toolbar { flex-wrap: wrap; }
  .privacy-badge { display: none; }
  .stats { grid-template-columns: repeat(2,minmax(0,1fr)); }
}
@media (max-width: 680px) {
  .app-shell { width: min(100% - 24px, 540px); padding-top: 20px; }
  .app-header { gap: 11px; flex-wrap: wrap; }
  .header-actions { width: 100%; flex-direction: row; justify-content: flex-end; align-items: center; margin-left: 0; }
  .brand-mark { width: 42px; height: 42px; flex-basis: 42px; }
  .stats { gap: 7px; }
  .stat { padding: 12px 10px; display: grid; gap: 3px; }
  .stat strong { font-size: 20px; }
  .stat span { font-size: 11px; }
  .workspace { grid-template-columns: 1fr; }
  .group-list { grid-template-columns: repeat(2,minmax(0,1fr)); }
  .group-item { padding: 8px; }
  .panel-header { flex-wrap: wrap; }
  .list-heading,.tenant-row { grid-template-columns: minmax(0,1fr) minmax(135px, 170px); gap: 10px; }
  .panel-header,.tenant-row,.toolbar,.manual-add { padding-left: 14px; padding-right: 14px; }
  .list-heading { padding-left: 14px; padding-right: 14px; }
  .hint { display: none; }
}
@media (max-width: 380px) {
  .list-heading,.tenant-row { grid-template-columns: minmax(0,1fr) 130px; }
  .group-list { grid-template-columns: 1fr; }
}`;

  const EDITOR_HTML = `
<div class="overlay" role="dialog" aria-modal="true" aria-label="Настройка групп EchoMind">
  <div class="app-shell">
    <header class="app-header">
      <div class="brand-mark" aria-hidden="true">◈</div>
      <div class="heading-content">
        <div class="eyebrow">ECHOMIND / TENANT GROUPS</div>
        <h1>Управление проектами</h1>
        <p>Добавляйте тенанты в несколько проектов — фильтр на странице обновляется автоматически.</p>
      </div>
      <div class="header-actions">
        <div class="header-buttons">
          <button id="exportConfig" type="button" class="back-button subtle" title="Скачать настройки в файл">Экспорт</button>
          <button id="importConfig" type="button" class="back-button subtle" title="Загрузить настройки из JSON">Импорт</button>
          <button id="backToTenants" type="button" class="back-button" title="Закрыть (Esc)">Вернуться к тенантам</button>
        </div>
        <div class="privacy-badge">● Только в браузере</div>
      </div>
    </header>

    <section class="stats" aria-label="Статистика">
      <div class="stat"><span>Проектов</span><strong id="groupCount">—</strong></div>
      <div class="stat"><span>Тенантов в списке</span><strong id="tenantCount">—</strong></div>
      <div class="stat"><span>Без группы</span><strong id="unassignedCount">—</strong></div>
      <div class="stat"><span>Закреплено ★</span><strong id="pinnedCount">—</strong></div>
    </section>

    <div class="workspace">
      <aside class="sidebar" aria-labelledby="groupsHeading">
        <div class="sidebar-title">
          <h2 id="groupsHeading">Проекты</h2>
          <span id="groupsCountPill" class="count-pill"></span>
        </div>
        <nav id="groupList" class="group-list" aria-label="Группы проектов"></nav>
        <form id="groupForm" class="add-form">
          <label for="newGroupName">Новый проект</label>
          <div class="field-inline">
            <input id="newGroupName" type="text" placeholder="Например, 4Rabet VIP" maxlength="120" required autocomplete="off">
            <button class="primary-button" type="submit">Создать проект</button>
          </div>
        </form>
      </aside>

      <main class="main-panel">
        <div class="panel-header">
          <div>
            <div class="eyebrow">НАСТРОЙКА ПРИВЯЗОК</div>
            <h2 id="tableHeading">Все тенанты</h2>
            <p id="tableSubtitle">Выберите один или несколько проектов для каждого тенанта.</p>
          </div>
          <div id="groupActions" class="group-actions" hidden>
            <button id="renameGroup" type="button" class="ghost-button">Переименовать</button>
            <button id="deleteGroup" type="button" class="danger-button">Удалить</button>
          </div>
        </div>

        <div class="toolbar">
          <label class="search-wrap" for="searchTenants">
            <span aria-hidden="true">⌕</span>
            <input id="searchTenants" type="search" placeholder="Найти тенант по названию" autocomplete="off">
          </label>
          <span class="hint">★ — закрепить сверху · изменения сохраняются автоматически</span>
        </div>

        <div class="list-heading" aria-hidden="true"><span>Тенант</span><span>Проекты</span></div>
        <div id="tenantList" class="tenant-list" aria-live="polite"></div>
        <div id="emptyState" class="empty-state" hidden>
          <span class="empty-icon">◇</span>
          <strong>Нет тенантов</strong>
          <p>Откройте страницу тенантов EchoMind или добавьте название вручную.</p>
        </div>

        <form id="tenantForm" class="manual-add">
          <div>
            <label for="newTenantName">Добавить тенант вручную</label>
            <p>Укажите название точно так, как оно отображается в EchoMind.</p>
          </div>
          <div class="field-inline">
            <input id="newTenantName" type="text" maxlength="120" required placeholder="Название тенанта" autocomplete="off">
            <button class="secondary-button" type="submit">Добавить</button>
          </div>
        </form>
      </main>
    </div>
    <footer>Скрипт скрывает и упорядочивает карточки только визуально. Доступы, API, Chatwoot и настройки тенантов не изменяются.</footer>
    <div id="toast" class="toast" role="status" aria-live="polite" hidden></div>
  </div>
</div>`;

  const editor = (() => {
    let host = null;
    let shadow = null;
    let focusId = ALL;
    let query = '';
    let openTenantKey = '';
    let toastTimer = null;
    let previousOverflow = '';
    const $ = id => shadow.getElementById(id);

    function element(tag, className, text) {
      const el = document.createElement(tag);
      if (className) el.className = className;
      if (text !== undefined) el.textContent = text;
      return el;
    }

    function titles() {
      return cleanSeen([...state.seen, ...state.config.groups.flatMap(group => group.tenants)])
        .sort((a, b) => collator.compare(a, b));
    }

    function flash(message, error = false) {
      clearTimeout(toastTimer);
      const toast = $('toast');
      toast.textContent = message;
      toast.classList.toggle('error', error);
      toast.hidden = false;
      toastTimer = setTimeout(() => { toast.hidden = true; }, 2900);
    }

    function countIn(groupId) {
      if (groupId === ALL) return titles().length;
      return titles().filter(title => {
        const membership = groupIds(state.config, title);
        return groupId === UNASSIGNED ? membership.length === 0 : membership.includes(groupId);
      }).length;
    }

    // Порядок проектов влияет на сортировку «По проектам» — его можно менять стрелками.
    function moveGroup(id, delta) {
      const groups = [...state.config.groups];
      const from = groups.findIndex(group => group.id === id);
      const to = from + delta;
      if (from < 0 || to < 0 || to >= groups.length) return;
      [groups[from], groups[to]] = [groups[to], groups[from]];
      saveConfig({ ...state.config, groups });
    }

    function renderGroups() {
      const { config } = state;
      const entries = [
        { id: ALL, name: 'Все тенанты', icon: '▦' },
        ...config.groups.map(group => ({ ...group, icon: '◈' })),
        { id: UNASSIGNED, name: 'Без группы', icon: '◇' }
      ];
      const list = $('groupList');
      list.replaceChildren();
      for (const entry of entries) {
        const row = element('div', 'group-row');
        const button = element('button', 'group-item');
        button.type = 'button';
        button.classList.toggle('active', focusId === entry.id);
        button.setAttribute('aria-current', focusId === entry.id ? 'true' : 'false');
        const icon = element('span', 'group-icon', entry.icon);
        icon.setAttribute('aria-hidden', 'true');
        const name = element('span', 'group-name', entry.name);
        const number = element('span', 'group-number', String(countIn(entry.id)));
        button.append(icon, name, number);
        button.addEventListener('click', () => {
          focusId = entry.id;
          openTenantKey = '';
          render();
        });
        row.append(button);

        const index = config.groups.findIndex(group => group.id === entry.id);
        if (index !== -1) {
          const up = element('button', 'move-button', '▲');
          up.type = 'button';
          up.title = 'Выше (порядок для сортировки «По проектам»)';
          up.disabled = index === 0;
          up.addEventListener('click', () => moveGroup(entry.id, -1));
          const down = element('button', 'move-button', '▼');
          down.type = 'button';
          down.title = 'Ниже';
          down.disabled = index === config.groups.length - 1;
          down.addEventListener('click', () => moveGroup(entry.id, 1));
          row.append(up, down);
        }
        list.append(row);
      }
    }

    function keepScroll(fn) {
      const list = $('tenantList');
      const scroll = list.scrollTop;
      fn();
      list.scrollTop = scroll;
    }

    function rowFor(key) {
      return [...$('tenantList').children].find(item => item.dataset.tenantKey === key);
    }

    function showMembershipChange(title, groupId, enabled) {
      const key = normalizeTitle(title);
      keepScroll(() => {
        // Название не теряется, даже если снята последняя галочка.
        if (!enabled) saveSeen([...state.seen, title]);
        saveConfig(setMembership(state.config, title, groupId, enabled));
      });
      [...(rowFor(key)?.querySelectorAll('.membership-choice input') || [])]
        .find(input => input.dataset.groupId === groupId)?.focus();
    }

    function renderTenants() {
      const { config } = state;
      const displayed = titles().filter(title => {
        const membership = groupIds(config, title);
        const matchesFocus = focusId === ALL ||
          (focusId === UNASSIGNED ? membership.length === 0 : membership.includes(focusId));
        return matchesFocus && normalizeTitle(title).includes(normalizeTitle(query));
      });
      const list = $('tenantList');
      list.replaceChildren();
      $('emptyState').hidden = displayed.length > 0;
      for (const [index, title] of displayed.entries()) {
        const key = normalizeTitle(title);
        const selectedIds = groupIds(config, title);
        const selectedNames = config.groups.filter(group => selectedIds.includes(group.id))
          .map(group => group.name);
        const expanded = openTenantKey === key;
        const pinned = isPinned(config, title);
        const row = element('div', 'tenant-row');
        row.dataset.tenantKey = key;

        const titleBox = element('div', 'tenant-details');
        const pin = element('button', 'pin-button', pinned ? '★' : '☆');
        pin.type = 'button';
        pin.title = pinned ? 'Открепить' : 'Закрепить сверху списка на странице';
        pin.setAttribute('aria-pressed', String(pinned));
        pin.addEventListener('click', () => {
          keepScroll(() => saveConfig(togglePinned(state.config, title)));
          rowFor(key)?.querySelector('.pin-button')?.focus();
        });
        const text = element('div', 'tenant-text');
        text.append(element('div', 'tenant-name', title));
        text.append(element('div', 'tenant-meta', selectedNames.length
          ? `В проектах: ${selectedNames.join(', ')}` : 'Не назначен'));
        titleBox.append(pin, text);

        const trigger = element('button', 'membership-trigger');
        trigger.type = 'button';
        trigger.setAttribute('aria-label', `Настроить проекты тенанта ${title}. Выбрано: ${selectedNames.length}`);
        trigger.setAttribute('aria-expanded', String(expanded));
        trigger.setAttribute('aria-controls', `membership-panel-${index}`);
        trigger.title = selectedNames.length ? selectedNames.join(', ') : 'Выбрать проекты';
        trigger.append(element('span', 'membership-label', selectedNames.length
          ? selectedNames.join(', ') : 'Выбрать проекты'));
        trigger.append(element('span', 'membership-count', String(selectedNames.length)));
        const arrow = element('span', 'membership-chevron');
        arrow.setAttribute('aria-hidden', 'true');
        trigger.append(arrow);
        trigger.addEventListener('click', () => {
          openTenantKey = expanded ? '' : key;
          renderTenants();
          const freshRow = rowFor(key);
          if (expanded) freshRow?.querySelector('.membership-trigger')?.focus();
          else freshRow?.querySelector('.membership-choice input')?.focus();
        });
        row.append(titleBox, trigger);

        if (expanded) {
          const panel = element('div', 'membership-panel');
          panel.id = `membership-panel-${index}`;
          const introduction = element('div', 'membership-intro');
          introduction.append(element('strong', '', 'Показывать тенант в проектах'));
          introduction.append(element('span', '', 'Отметьте все подходящие группы. Изменения сохраняются сразу.'));
          panel.append(introduction);
          const grid = element('div', 'membership-grid');
          if (config.groups.length === 0) {
            grid.append(element('p', 'membership-empty', 'Сначала создайте проект в левой панели.'));
          }
          for (const group of config.groups) {
            const choice = element('label', 'membership-choice');
            const checkbox = document.createElement('input');
            checkbox.type = 'checkbox';
            checkbox.dataset.groupId = group.id;
            checkbox.checked = selectedIds.includes(group.id);
            checkbox.addEventListener('change', () => showMembershipChange(title, group.id, checkbox.checked));
            choice.append(checkbox, element('span', '', group.name));
            grid.append(choice);
          }
          panel.append(grid);
          const actions = element('div', 'membership-actions');
          const clear = element('button', 'membership-clear', 'Снять все');
          clear.type = 'button';
          clear.disabled = selectedIds.length === 0;
          clear.addEventListener('click', () => {
            keepScroll(() => {
              saveSeen([...state.seen, title]);
              saveConfig(clearMemberships(state.config, title));
            });
            rowFor(key)?.querySelector('.membership-clear')?.focus();
          });
          const done = element('button', 'membership-done', 'Готово');
          done.type = 'button';
          done.addEventListener('click', () => {
            openTenantKey = '';
            renderTenants();
            rowFor(key)?.querySelector('.membership-trigger')?.focus();
          });
          actions.append(clear, done);
          panel.append(actions);
          row.append(panel);
        }
        list.append(row);
      }
    }

    function render() {
      if (!shadow) return;
      const { config } = state;
      const allTitles = titles();
      if (focusId !== ALL && focusId !== UNASSIGNED &&
          !config.groups.some(group => group.id === focusId)) focusId = ALL;
      $('groupCount').textContent = String(config.groups.length);
      $('tenantCount').textContent = String(allTitles.length);
      $('unassignedCount').textContent = String(countIn(UNASSIGNED));
      $('pinnedCount').textContent = String(config.pinned.length);
      $('groupsCountPill').textContent = String(config.groups.length);
      const active = config.groups.find(group => group.id === focusId);
      $('tableHeading').textContent = active?.name ?? (focusId === UNASSIGNED ? 'Без группы' : 'Все тенанты');
      $('tableSubtitle').textContent = active
        ? 'Тенанты этого проекта. Можно добавить их и в другие проекты.'
        : 'Выберите один или несколько проектов для каждого тенанта.';
      $('groupActions').hidden = !active;
      renderGroups();
      renderTenants();
    }

    function makeGroup(name) {
      const clean = cleanName(name);
      if (!clean) return flash('Укажите название проекта', true);
      if (state.config.groups.some(group => normalizeTitle(group.name) === normalizeTitle(clean))) {
        return flash('Проект с таким названием уже есть', true);
      }
      const id = makeId();
      focusId = id;
      $('newGroupName').value = '';
      saveConfig({ ...state.config, groups: [...state.config.groups, { id, name: clean, tenants: [] }] });
      flash('Проект создан');
    }

    function exportConfig() {
      const payload = JSON.stringify({ [CONFIG_KEY]: state.config, [SEEN_KEY]: state.seen }, null, 2);
      const url = URL.createObjectURL(new Blob([payload], { type: 'application/json' }));
      const link = document.createElement('a');
      link.href = url;
      link.download = `echomind-tenant-groups-${new Date().toISOString().slice(0, 10)}.json`;
      shadow.append(link);
      link.click();
      link.remove();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
      flash('Настройки сохранены в файл');
    }

    // Принимает экспорт этого скрипта или данные storage.local из расширения.
    function importConfig() {
      const text = window.prompt('Вставьте JSON с настройками (экспорт скрипта или данные расширения):', '');
      if (text === null || !text.trim()) return;
      let data;
      try {
        data = JSON.parse(text);
      } catch (_) {
        return flash('Это не JSON — проверьте, что скопировано целиком', true);
      }
      const rawConfig = data?.[CONFIG_KEY] ?? (Array.isArray(data?.groups) ? data : null);
      if (!rawConfig || !Array.isArray(rawConfig.groups)) {
        return flash('В JSON не найдены группы проектов', true);
      }
      const next = normalizeConfig(rawConfig);
      if (!window.confirm(`Заменить текущие настройки? Проектов в файле: ${next.groups.length}.`)) return;
      saveSeen([...state.seen, ...(Array.isArray(data?.[SEEN_KEY]) ? data[SEEN_KEY] : [])]);
      focusId = ALL;
      saveConfig(next);
      flash('Настройки импортированы');
    }

    function onKeydown(event) {
      if (event.key === 'Escape' && !openTenantKey) {
        event.stopPropagation();
        close();
      } else if (event.key === 'Escape' && openTenantKey) {
        event.stopPropagation();
        const key = openTenantKey;
        openTenantKey = '';
        renderTenants();
        rowFor(key)?.querySelector('.membership-trigger')?.focus();
      }
    }

    function build() {
      host = document.createElement('div');
      host.id = 'emtf-editor-host';
      shadow = host.attachShadow({ mode: 'open' });
      const style = document.createElement('style');
      style.textContent = EDITOR_CSS;
      const wrapper = document.createElement('div');
      wrapper.innerHTML = EDITOR_HTML;
      shadow.append(style, ...wrapper.childNodes);

      $('backToTenants').addEventListener('click', close);
      $('exportConfig').addEventListener('click', exportConfig);
      $('importConfig').addEventListener('click', importConfig);
      $('groupForm').addEventListener('submit', event => {
        event.preventDefault();
        makeGroup($('newGroupName').value);
      });
      $('tenantForm').addEventListener('submit', event => {
        event.preventDefault();
        const name = cleanName($('newTenantName').value);
        if (!name) return flash('Укажите название тенанта', true);
        if (titles().some(title => normalizeTitle(title) === normalizeTitle(name))) {
          return flash('Такой тенант уже есть в списке', true);
        }
        $('newTenantName').value = '';
        saveSeen([...state.seen, name]);
        if (state.config.groups.some(group => group.id === focusId)) {
          saveConfig(setMembership(state.config, name, focusId, true));
        }
        flash('Тенант добавлен');
      });
      $('searchTenants').addEventListener('input', event => {
        query = event.target.value;
        renderTenants();
      });
      $('renameGroup').addEventListener('click', () => {
        const group = state.config.groups.find(item => item.id === focusId);
        if (!group) return;
        const proposed = window.prompt('Новое название проекта:', group.name);
        if (proposed === null) return;
        const name = cleanName(proposed);
        if (!name) return flash('Название не может быть пустым', true);
        if (state.config.groups.some(item => item.id !== group.id &&
            normalizeTitle(item.name) === normalizeTitle(name))) {
          return flash('Проект с таким названием уже есть', true);
        }
        saveConfig({
          ...state.config,
          groups: state.config.groups.map(item => item.id === group.id ? { ...item, name } : item)
        });
        flash('Название обновлено');
      });
      $('deleteGroup').addEventListener('click', () => {
        const group = state.config.groups.find(item => item.id === focusId);
        if (!group) return;
        if (!window.confirm(`Удалить проект «${group.name}»? Привязка к нему исчезнет. Остальные группы тенантов сохранятся.`)) return;
        // Названия тенантов остаются в настройках и после удаления проекта.
        saveSeen([...state.seen, ...group.tenants]);
        focusId = ALL;
        saveConfig({
          ...state.config,
          selected: state.config.selected === group.id ? ALL : state.config.selected,
          groups: state.config.groups.filter(item => item.id !== group.id)
        });
        flash('Проект удалён. Остальные привязки сохранены.');
      });
      shadow.addEventListener('keydown', onKeydown);
    }

    function open() {
      if (!host) build();
      if (!host.isConnected) {
        document.body.append(host);
        previousOverflow = document.documentElement.style.overflow;
        document.documentElement.style.overflow = 'hidden';
      }
      render();
      $('backToTenants').focus();
    }

    function close() {
      if (!host?.isConnected) return;
      host.remove();
      document.documentElement.style.overflow = previousOverflow;
      openTenantKey = '';
      toolbar?.querySelector('.emtf-settings')?.focus();
    }

    listeners.add(() => {
      if (host?.isConnected) render();
    });

    return { open, close };
  })();

  /* ======================= Экспорт тенанта (новый UI: Agents → Answer Agent) ======================= */
  /*
   * Только чтение интерфейса: скрипт открывает разделы бокового меню агента
   * (Knowledge / Prompts → Conversation / Functions), нажимает «глаз» и «карандаш»,
   * читает поля и закрывает окна. Своих запросов к серверу нет. Никогда не нажимает
   * Save / Delete / Upload / Synchronize / Create. Всё собирается в ZIP прямо в браузере.
   */
  const exporter = (() => {
    const EXPORT_PREFIX = 'emtf_export_';
    const DANGER_RE = /delete|remove|trash|удал|save|сохран|upload|загруз|synchron|синхрон|deploy|publish|submit|create|созда|logout|выйти|run\s*test/i;
    const CLOSE_RE = /^(close|cancel|закрыть|отмена|отменить|назад|back|×|✕|x)$/i;
    const EYE_RE = /\beye\b|visib|view|preview|просмотр/i;
    const EDIT_RE = /pencil|\bpen\b|square-pen|\bedit\b|изм/i;
    const PLAY_RE = /\bplay\b/i;
    const CHEVRON_RE = /chevron-(down|up)|chevrons-(down|up)/i;
    const SECTION_NAMES = { documents: 'Knowledge Base', prompts: 'Промпты', functions: 'Функции', tags: 'Теги' };
    // Пункты бокового меню агента. Для промптов — сначала подпункт Conversation.
    const NAV_LABELS = {
      documents: ['Knowledge', 'Knowledge Base'],
      prompts: ['Conversation', 'Prompts'],
      functions: ['Functions'],
      tags: ['Tagging Agent', 'Tagging', 'Tags'],
      test: ['Test prompts', 'Test']
    };
    const DEFAULT_AGENT = 'Answer Agent';
    const KNOWN_PROMPTS = ['Tags', 'Identify Conversation Idea', 'Filter Knowledge', 'Answers', 'Is Reassign?', 'Judge'];
    // Что не нужно выгружать из функций (адреса, маппинги, токены).
    const FUNCTION_SKIP_RE = /mapping|маппинг|\burl\b|endpoint|адрес/i;
    const FIELD_SEL = 'input, textarea, select, [contenteditable="true"]';
    const ENABLED_KEY = 'emtf_export_enabled';
    const PENDING_KEY = 'emtf_export_pending';
    const POSITION_KEY = 'emtf_export_pos';

    let widget = null;
    let els = {};
    let running = false;
    let stopRequested = false;
    let tenant = null;

    const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
    const isOurs = node => Boolean(node?.closest?.('#emtf-export, #emtf-toolbar, #emtf-view, #emtf-editor-host'));
    const visible = node => Boolean(node && node.getClientRects().length &&
      getComputedStyle(node).visibility !== 'hidden');
    const textOf = node => (node?.innerText ?? node?.textContent ?? '').trim();
    const firstLine = node => textOf(node).split('\n').map(line => line.trim()).find(Boolean) || '';
    const svgClasses = node => [...node.querySelectorAll('svg')].map(svg => svg.getAttribute('class') || '').join(' ');

    function iconName(button) {
      return [button.getAttribute('aria-label'), button.title, button.getAttribute('data-testid'),
        ...[...button.querySelectorAll('[data-testid]')].map(item => item.getAttribute('data-testid')),
        svgClasses(button)].filter(Boolean).join(' ');
    }

    async function waitFor(check, timeout = 10000, interval = 120) {
      const end = Date.now() + timeout;
      while (Date.now() < end) {
        if (stopRequested) throw new Error('Остановлено');
        const value = check();
        if (value) return value;
        await sleep(interval);
      }
      return null;
    }

    // Ждём, пока содержимое перестанет меняться (данные подгружаются асинхронно).
    async function waitStable(read, { timeout = 10000, quiet = 450, allowEmpty = false } = {}) {
      const end = Date.now() + timeout;
      let last = null;
      let since = Date.now();
      while (Date.now() < end) {
        if (stopRequested) throw new Error('Остановлено');
        const value = read();
        if (value !== last) {
          last = value;
          since = Date.now();
        } else if ((allowEmpty || value) && Date.now() - since >= quiet) {
          return value;
        }
        await sleep(100);
      }
      return last;
    }

    function dispatchClick(node) {
      if (!node) return false;
      const opts = { bubbles: true, cancelable: true };
      try {
        node.dispatchEvent(new PointerEvent('pointerdown', opts));
        node.dispatchEvent(new MouseEvent('mousedown', opts));
        node.dispatchEvent(new PointerEvent('pointerup', opts));
        node.dispatchEvent(new MouseEvent('mouseup', opts));
      } catch (_) { /* если конструктор недоступен, хватит обычного click() */ }
      node.click();
      return true;
    }

    // checkText: false — для заголовков карточек промптов (в превью текста может быть слово «save» и т. п.).
    function safeClick(node, { checkText = true } = {}) {
      if (!node) return false;
      const label = [iconName(node), checkText ? textOf(node).slice(0, 200) : ''].join(' ');
      if (DANGER_RE.test(label)) throw new Error(`Отказ нажимать опасную кнопку: ${label.trim().slice(0, 80)}`);
      node.scrollIntoView({ block: 'center' });
      dispatchClick(node);
      return true;
    }

    /* ---------- Продукт (тенант) и агент ---------- */

    function detectAgent(text) {
      // В боковом меню агента: «Answer Agent» и под ним тип «ANSWER AGENT».
      const lines = text.split('\n').map(line => line.trim()).filter(Boolean);
      for (let i = 0; i < lines.length - 1; i++) {
        if (/agent$/i.test(lines[i]) && lines[i].length <= 60 &&
            lines[i].toLowerCase() === lines[i + 1].toLowerCase()) return lines[i];
      }
      return '';
    }

    function detectTenant() {
      const text = document.body?.innerText || '';
      const uuid = '([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})';
      const id = text.match(new RegExp(`(?:Tenant|Product)\\s*Id\\s*:\\s*${uuid}`, 'i'))?.[1] ||
        location.pathname.match(/\/tenants\/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})/i)?.[1];
      if (!id) return null;
      const name = text.match(/(?:Tenant|Product)\s*Name\s*:\s*([^\n]+?)\s*,?\s*(?:\n|(?:Tenant|Product)\s*Id)/i)?.[1]
        ?.replace(/,\s*$/, '').trim() || id;
      return { id, name, agent: detectAgent(text) };
    }

    const agentName = () => tenant?.agent || DEFAULT_AGENT;
    const storeKey = () => `${EXPORT_PREFIX}${tenant.id}`;
    function loadData() {
      const cur = gmRead(storeKey());
      if (cur && cur.sections) return cur;
      const leg = gmRead(`${EXPORT_PREFIX}${tenant.id}::${agentName()}`);
      if (leg && leg.sections) return leg;
      return { tenant, sections: {} };
    }
    function saveData(data) {
      gmWrite(storeKey(), { ...data, tenant: { ...tenant, agent: agentName() } });
    }

    /* ---------- Поиск элементов по тексту ---------- */

    // Элементы, чей собственный текст точно равен одной из подписей.
    function findLeaves(labels, { inTables = false } = {}) {
      const wanted = new Set(labels.map(label => label.toLowerCase()));
      const result = [];
      if (!document.body) return result;
      const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
      while (walker.nextNode()) {
        const raw = walker.currentNode.nodeValue;
        if (!raw || raw.length > 80) continue;
        const value = raw.trim().replace(/\s+/g, ' ').toLowerCase();
        if (!value || !wanted.has(value)) continue;
        const el = walker.currentNode.parentElement;
        if (!el || isOurs(el) || el.closest('textarea, [role="dialog"], script, style') ||
            (!inTables && el.closest('table')) || !visible(el)) continue;
        result.push(el);
      }
      return result;
    }

    // Боковое меню агента (Knowledge / Filters / Prompts / Test prompts / Functions).
    function menuRoot() {
      const knowledge = findLeaves(['Knowledge', 'Knowledge Base']);
      if (!knowledge.length) return null;
      const functions = findLeaves(['Functions']);
      for (const a of knowledge) {
        for (const b of functions) {
          let node = a.parentElement;
          for (let depth = 0; node && depth < 8; depth++, node = node.parentElement) {
            if (!node.contains(b)) continue;
            if (node.querySelector('table, textarea, input, [role="dialog"]')) break;
            return node;
          }
        }
      }
      return null;
    }

    function navItem(section) {
      const root = menuRoot();
      if (!root) return null;
      for (const label of NAV_LABELS[section]) {
        const leaf = findLeaves([label]).find(node => root.contains(node));
        if (leaf) return leaf.closest('a, button, [role="button"], [role="menuitem"]') || leaf;
      }
      return null;
    }

    // Со страницы Agents открываем Answer Agent.
    async function openAgent() {
      if (menuRoot()) return;
      const leaf = findLeaves([DEFAULT_AGENT], { inTables: true })[0];
      if (!leaf) throw new Error('Откройте Agents → Answer Agent и запустите снова');
      safeClick(leaf.closest('a, button, [role="button"]') || leaf);
      if (!await waitFor(menuRoot, 15000)) throw new Error('Answer Agent не открылся');
      await sleep(600);
    }

    /* ---------- Поля форм ---------- */

    const cleanLabel = text => String(text).replace(/\s*\*$/, '').trim();

    function fieldLabel(field) {
      const byFor = field.id && document.querySelector(`label[for="${CSS.escape(field.id)}"]`);
      if (byFor && textOf(byFor)) return cleanLabel(firstLine(byFor));
      if (field.getAttribute('aria-label')) return field.getAttribute('aria-label');
      const labelledBy = field.getAttribute('aria-labelledby');
      if (labelledBy) {
        const text = labelledBy.split(/\s+/).map(id => textOf(document.getElementById(id))).join(' ').trim();
        if (text) return text;
      }
      // Подпись — <label>/<legend> рядом или самый верхний текстовый блок перед полем
      // (в новом UI: заголовок «Function name», под ним серая подсказка, затем поле).
      let node = field;
      for (let depth = 0; node?.parentElement && depth < 6; depth++, node = node.parentElement) {
        const parent = node.parentElement;
        const label = parent.querySelector(':scope > label, :scope > fieldset legend, :scope > legend');
        if (label && textOf(label) && !label.querySelector(FIELD_SEL)) return cleanLabel(firstLine(label));
        let top = '';
        for (let sib = node.previousElementSibling; sib; sib = sib.previousElementSibling) {
          if (sib.matches(FIELD_SEL) || sib.querySelector(FIELD_SEL)) break;
          const line = firstLine(sib);
          if (line && line.length <= 80) top = line;
        }
        if (top) return cleanLabel(top);
      }
      return field.placeholder || field.name || 'Поле';
    }

    function fieldValue(field) {
      if (!field) return '';
      if (field.matches('[contenteditable="true"]')) return field.innerText;
      if (field.type === 'checkbox' || field.type === 'radio') return field.checked ? 'да' : 'нет';
      if (field.tagName === 'SELECT') return field.selectedOptions[0]?.textContent ?? field.value;
      return field.value;
    }

    function collectFields(container) {
      const selector = [
        'textarea:not([aria-hidden="true"])',
        'input:not([type="hidden"]):not([type="file"]):not([type="button"]):not([type="submit"]):not([aria-hidden="true"])',
        'select', '[contenteditable="true"]'
      ].join(',');
      const fields = [];
      const used = new Map();
      for (const field of container.querySelectorAll(selector)) {
        if (isOurs(field) || field.readOnly && field.tabIndex === -1) continue;
        if (!visible(field) && field.type !== 'checkbox') continue;
        let label = fieldLabel(field).trim() || 'Поле';
        const count = (used.get(label) || 0) + 1;
        used.set(label, count);
        if (count > 1) label = `${label} (${count})`;
        fields.push({ label, value: String(fieldValue(field) ?? '') });
      }
      return fields;
    }

    /* ---------- Окна (диалоги) ---------- */

    function dialogs() {
      return [...document.querySelectorAll('[role="dialog"], [role="alertdialog"], [aria-modal="true"], .MuiDialog-paper, .MuiDrawer-paper, .modal')]
        .filter(node => !isOurs(node) && visible(node));
    }

    async function closeDialog(dialog) {
      const gone = () => !dialog.isConnected || !visible(dialog);
      const escape = new KeyboardEvent('keydown', { key: 'Escape', code: 'Escape', keyCode: 27, bubbles: true });
      (dialog.querySelector('[tabindex]') || dialog).dispatchEvent(escape);
      document.activeElement?.dispatchEvent(escape);
      if (await waitFor(gone, 1500)) return;

      const close = [...dialog.querySelectorAll('button, [role="button"]')].find(button => {
        const label = (button.getAttribute('aria-label') || textOf(button) || button.title || '').trim();
        return CLOSE_RE.test(label) || /close|закр/i.test(button.getAttribute('aria-label') || '') ||
          /(^|\s)lucide-x(\s|$)/.test(svgClasses(button)) || button.querySelector('[data-testid="CloseIcon"]');
      });
      if (close) close.click();
      if (await waitFor(gone, 1500)) return;

      const backdrop = document.querySelector('.MuiBackdrop-root, .modal-backdrop, [data-radix-dialog-overlay], [class*="backdrop" i], [class*="overlay" i]');
      if (backdrop && !isOurs(backdrop)) {
        for (const type of ['pointerdown', 'mousedown', 'mouseup', 'click']) {
          backdrop.dispatchEvent(new MouseEvent(type, { bubbles: true }));
        }
      }
      if (!await waitFor(gone, 2000)) throw new Error('Не удалось закрыть окно — закройте его вручную и запустите снова');
    }

    // Текст документа из окна просмотра: поле, <pre> или самый большой текстовый блок.
    function dialogText(dialog) {
      const field = [...dialog.querySelectorAll('textarea:not([aria-hidden="true"]), [contenteditable="true"]')]
        .find(visible);
      if (field) return fieldValue(field);
      const pre = [...dialog.querySelectorAll('pre, code')].sort((a, b) => textOf(b).length - textOf(a).length)[0];
      if (pre && textOf(pre).length > 20) return pre.innerText;
      let best = dialog;
      let bestLength = 0;
      for (const node of dialog.querySelectorAll('div, section, article, p')) {
        if (node.querySelector('button')) continue;
        const length = textOf(node).length;
        if (length > bestLength) {
          best = node;
          bestLength = length;
        }
      }
      return best.innerText;
    }

    /* ---------- Таблица документов ---------- */

    function tableRows(predicate) {
      const tables = [...document.querySelectorAll('table, [role="table"], [role="grid"]')].filter(table => !isOurs(table));
      for (const table of tables) {
        const rows = [...table.querySelectorAll('tbody tr, [role="rowgroup"] [role="row"]')]
          .filter(row => row.querySelector('td, [role="cell"]'));
        if (rows.length && predicate(table, rows)) return { table, rows };
      }
      return null;
    }

    const cellsOf = row => [...row.querySelectorAll(':scope > td, :scope > [role="cell"]')];
    const headersOf = table => [...table.querySelectorAll('thead th, [role="columnheader"]')].map(th => textOf(th));

    function rowButtons(row) {
      const cells = cellsOf(row);
      const scope = cells[cells.length - 1] || row;
      return [...scope.querySelectorAll('button, [role="button"], a')].filter(visible);
    }

    const docsTable = () => tableRows(table => headersOf(table).some(h => /file\s*name|имя файла/i.test(h)));

    // Пагинация: «›» рядом с «Rows per page … 1–9 of 9».
    async function nextPage(table) {
      let root = table.parentElement;
      let next = null;
      for (let depth = 0; root && depth < 6 && !next; depth++, root = root.parentElement) {
        next = [...root.querySelectorAll('button, [role="button"]')].find(button => !isOurs(button) &&
          !table.contains(button) && visible(button) &&
          (/next|следующ/i.test(button.getAttribute('aria-label') || button.title || '') ||
           /chevron-right|arrow-right/i.test(svgClasses(button))));
      }
      if (!next || next.disabled || next.getAttribute('aria-disabled') === 'true') return false;
      const body = () => textOf(table.querySelector('tbody, [role="rowgroup"]'));
      const before = body();
      next.click();
      return Boolean(await waitFor(() => table.isConnected && body() !== before, 8000));
    }

    /* ---------- Функции: карточки «{} имя  описание  ▷ ✎ 🗑» ---------- */

    const pageButtons = () => {
      const root = menuRoot();
      return [...document.querySelectorAll('button, [role="button"]')].filter(button => !isOurs(button) &&
        visible(button) && !(root && root.contains(button)) && !button.closest('[role="dialog"], table'));
    };
    const hasCreateFunction = buttons => buttons.some(button => /create function|new function|add function|создать функ/i.test(textOf(button)));

    function functionName(row) {
      const code = row.querySelector('code, kbd, [class*="mono" i], [class*="badge" i]');
      const raw = code && textOf(code) ? textOf(code) : firstLine(row);
      return raw.match(/[A-Za-z_][\w.-]*/)?.[0] || '';
    }

    function functionRows() {
      const buttons = pageButtons();
      let anchors = buttons.filter(button => PLAY_RE.test(iconName(button)));
      if (!anchors.length && hasCreateFunction(buttons)) anchors = buttons.filter(button => EDIT_RE.test(iconName(button)));
      if (!anchors.length) return [];
      const root = menuRoot();
      const rows = anchors.map(anchor => {
        let node = anchor;
        while (node.parentElement && node.parentElement !== document.body && node.parentElement.tagName !== 'MAIN' &&
          !(root && node.parentElement.contains(root)) &&
          !hasCreateFunction([...node.parentElement.querySelectorAll('button')]) &&
          anchors.filter(other => node.parentElement.contains(other)).length === 1) node = node.parentElement;
        return node;
      });
      return rows.map(row => ({ row, name: functionName(row) })).filter(item => item.name);
    }

    function rowEditButton(row) {
      const buttons = [...row.querySelectorAll('button, [role="button"]')].filter(visible);
      return buttons.find(button => EDIT_RE.test(iconName(button))) || (buttons.length === 3 ? buttons[1] : null);
    }

    /* ---------- Промпты: раскрывающиеся карточки (aria-expanded) ---------- */

    function promptCards() {
      const root = menuRoot();
      const result = [];
      const names = new Set();
      const toggles = [...document.querySelectorAll('button[aria-expanded]')].filter(button =>
        !isOurs(button) && visible(button) && !button.getAttribute('aria-haspopup') &&
        !(root && root.contains(button)) &&
        !button.closest('header, nav, [role="dialog"], table') && button.querySelector('p'));
      for (const toggle of toggles) {
        const titleEl = toggle.querySelector('p.font-semibold, [class*="font-semibold"]') || toggle.querySelector('p');
        const name = firstLine(titleEl);
        if (!name || name.length > 80 || names.has(name.toLowerCase())) continue;
        const card = toggle.parentElement?.closest('.overflow-hidden, .rounded-xl') || toggle.parentElement?.parentElement;
        if (!card) continue;
        names.add(name.toLowerCase());
        result.push({ name, toggle, card, header: toggle.parentElement });
      }
      return result;
    }

    function getPromptChevron(item) {
      if (!item?.card) return item?.toggle;
      const chevron = item.card.querySelector('button svg.lucide-chevron-down, button svg.lucide-chevron-up, button svg[class*="chevron"]')?.closest('button');
      return chevron || item.toggle;
    }

    function isPromptCardOpen(item) {
      if (!item?.card) return false;
      if (item.card.querySelector('textarea')) return true;
      if (item.card.querySelector('svg.lucide-chevron-up, [class*="chevron-up"]')) return true;
      return item?.toggle?.getAttribute('aria-expanded') === 'true';
    }

    function readPromptText(item) {
      if (!item) return '';
      const body = [...item.card.children].filter(child => child !== item.header && !child.contains(item.toggle));
      const scopes = body.length ? body : [item.card];

      const areas = scopes.flatMap(scope => [...scope.querySelectorAll('textarea')]).filter(area => area.value.trim());
      if (areas.length) return areas.sort((a, b) => b.value.length - a.value.length)[0].value;

      const editable = scopes.flatMap(scope => [...scope.querySelectorAll('[contenteditable="true"]')])
        .find(node => node.innerText?.trim());
      if (editable) return editable.innerText;

      const monaco = scopes.map(scope => scope.querySelector('.monaco-editor')).find(Boolean);
      if (monaco) {
        const lines = monaco.querySelectorAll('.view-line');
        if (lines.length) return [...lines].map(line => line.innerText).join('\n');
      }

      return scopes.map(scope => scope.innerText || '').join('\n').trim();
    }

    function isPromptsPage() {
      const cards = promptCards();
      return cards.length > 0 && (/\/prompts(\/|$)/i.test(location.pathname) ||
        cards.some(item => KNOWN_PROMPTS.some(name => name.toLowerCase() === item.name.toLowerCase())));
    }

    function isTestPromptsPage() {
      return /test-prompts(\/|$)/i.test(location.pathname) ||
        Boolean(document.querySelector('textarea[aria-label="Test text"], button[aria-label="Save parameter"], button:has(svg.lucide-flask-conical)'));
    }

    function detectSection() {
      if (docsTable()) return 'documents';
      if (findTagsRows()) return 'tags';
      if (functionRows().length) return 'functions';
      if (isPromptsPage()) return 'prompts';
      if (isTestPromptsPage()) return 'test';
      return null;
    }

    /* ---------- Сбор: документы ---------- */

    async function collectDocuments(progress) {
      const items = [];
      const seenNames = new Set();
      for (let page = 1; page <= 50; page++) {
        const found = docsTable();
        if (!found) break;
        await waitStable(() => textOf(found.table.querySelector('tbody, [role="rowgroup"]')), { timeout: 5000 });
        const headers = headersOf(found.table);
        for (let index = 0; index < found.rows.length; index++) {
          const row = docsTable()?.rows[index];
          if (!row) break;
          const cellNodes = cellsOf(row);
          const cells = cellNodes.map(textOf);
          const name = cellNodes[0]?.querySelector('[title]')?.getAttribute('title') || cells[0] || `document-${items.length + 1}`;
          if (seenNames.has(name)) continue;
          progress(`Документ ${items.length + 1}: ${name}`);
          const meta = {};
          headers.forEach((header, i) => {
            if (i > 0 && header && !/action|действ/i.test(header)) meta[header] = cells[i] ?? '';
          });

          const buttons = rowButtons(row);
          const view = buttons.find(button => EYE_RE.test(iconName(button))) ||
            buttons.find(button => !DANGER_RE.test(iconName(button)) && !EDIT_RE.test(iconName(button)));
          let content = '';
          let error = '';
          try {
            if (!view) throw new Error('не найдена кнопка просмотра');
            const before = new Set(dialogs());
            safeClick(view);
            const dialog = await waitFor(() => dialogs().find(node => !before.has(node)), 8000);
            if (!dialog) throw new Error('окно просмотра не открылось');
            content = await waitStable(() => dialogText(dialog), { timeout: 15000 });
            await closeDialog(dialog);
          } catch (err) {
            if (stopRequested) throw err;
            error = err.message;
          }
          seenNames.add(name);
          items.push({ name, meta, content, ...(error ? { error } : {}) });
        }
        if (!await nextPage(found.table)) break;
      }
      return items;
    }

    /* ---------- Сбор: промпты ---------- */

    async function collectPrompts(progress, { confirmed = false } = {}) {
      const cards = promptCards();
      if (!cards.length) throw new Error('Карточки промптов не найдены');
      const dirty = pageButtons().some(button => /^(save|save changes|сохранить)$/i.test(textOf(button)) &&
        !button.disabled && button.getAttribute('aria-disabled') !== 'true');
      if (!confirmed && dirty &&
          !window.confirm('Похоже, в промптах есть несохранённые правки — раскрытие карточек может их сбросить.\nПродолжить экспорт?')) {
        throw new Error('Отменено');
      }
      const names = cards.map(item => item.name);
      const find = name => promptCards().find(item => item.name.toLowerCase() === name.toLowerCase());
      const items = [];

      for (const [index, name] of names.entries()) {
        progress(`Промпт ${index + 1}/${names.length}: ${name}`);
        let value = '';
        let error = '';
        let openedByUs = false;
        const meta = {};
        try {
          let item = find(name);
          if (!item) throw new Error('карточка не найдена');

          if (!isPromptCardOpen(item)) {
            item.toggle.scrollIntoView({ block: 'center' });
            item.toggle.click();
            openedByUs = true;
            let opened = await waitFor(() => isPromptCardOpen(find(name)), 3000, 100);
            if (!opened) {
              // Второй способ — только если карточка точно не раскрылась (иначе закроем её).
              const fresh = find(name);
              const chevron = fresh && getPromptChevron(fresh);
              if (chevron && chevron !== fresh.toggle && fresh.toggle.getAttribute('aria-expanded') !== 'true') {
                chevron.click();
                opened = await waitFor(() => isPromptCardOpen(find(name)), 3000, 100);
              }
            }
            if (!opened) throw new Error('промпт не раскрылся');
          }

          value = await waitStable(() => readPromptText(find(name)), { timeout: 10000, quiet: 400 }) || '';
          if (!value.trim()) throw new Error('текст промпта пустой');

          item = find(name);
          const text = item ? textOf(item.card) : '';
          const temperature = text.match(/Temperature\s*:?\s*([\d.,]+)/i)?.[1];
          const required = text.match(/Required\s*:?\s*\n?\s*([^\n]+)/i)?.[1]?.replace(/\s*Temperature.*$/i, '').trim();
          if (temperature) meta.Temperature = temperature;
          if (required) meta.Required = required;
        } catch (err) {
          if (stopRequested) throw err;
          error = err.message;
        } finally {
          if (openedByUs) {
            const current = find(name);
            if (current && isPromptCardOpen(current)) {
              current.toggle.click();
              await sleep(250);
            }
          }
        }
        items.push({ name, fields: error && !value ? [] : [{ label: 'Prompt', value }], meta, ...(error ? { error } : {}) });
      }
      return items;
    }

    /* ---------- Сбор: функции ---------- */

    async function collectFunctions(progress) {
      const items = [];
      const names = [...new Set(functionRows().map(item => item.name))];
      for (const [index, name] of names.entries()) {
        progress(`Функция ${index + 1}/${names.length}: ${name}`);
        let fields = [];
        let error = '';
        const table = {};
        try {
          const found = functionRows().find(item => item.name === name);
          if (!found) throw new Error('строка функции не найдена');
          const description = textOf(found.row).replace(name, '').replace(/^[\s{}()[\]]+/, '')
            .split('\n').map(line => line.trim()).filter(Boolean).join(' ');
          if (description) table.Description = description;

          const edit = rowEditButton(found.row);
          if (!edit) throw new Error('не найдена кнопка редактирования');
          const before = new Set(dialogs());
          safeClick(edit);
          const dialog = await waitFor(() => {
            const fresh = dialogs().find(node => !before.has(node));
            return fresh && collectFields(fresh).length ? fresh : null;
          }, 10000);
          if (!dialog) throw new Error('окно «Edit function» не открылось');
          fields = JSON.parse(await waitStable(() => JSON.stringify(collectFields(dialog)), { timeout: 10000 }) || '[]')
            .filter(field => !FUNCTION_SKIP_RE.test(field.label));
          await closeDialog(dialog);
          await waitFor(() => functionRows().length, 8000);
        } catch (err) {
          if (stopRequested) throw err;
          error = err.message;
          // Если окно осталось открытым — пробуем закрыть, чтобы не мешало следующим.
          const left = dialogs()[0];
          if (left) await closeDialog(left).catch(() => {});
        }
        items.push({ name, table, fields, ...(error ? { error } : {}) });
      }
      return items;
    }

    /* ---------- Сбор: теги (Tagging Agent) ---------- */

    const tagsTable = () => tableRows(table => {
      const headers = headersOf(table).map(h => h.trim().toLowerCase());
      const hasName = headers.some(h => h === 'name' || h.includes('tag'));
      const hasDesc = headers.some(h => h.includes('desc') || h.includes('описан'));
      return hasName && hasDesc;
    });

    function findTagsRows() {
      const found = tagsTable();
      if (found) return found;

      // Fallback на случай кастомной div-таблицы
      const headerDiv = [...document.querySelectorAll('div, header')].find(el => {
        if (isOurs(el)) return false;
        const txt = textOf(el).toLowerCase();
        return /\bname\b/.test(txt) && /\bdescription\b/.test(txt) && txt.length < 100;
      });
      if (headerDiv && headerDiv.parentElement) {
        const rows = [...headerDiv.parentElement.children].filter(child => {
          return child !== headerDiv && !isOurs(child) && child.querySelectorAll('button, svg').length > 0;
        });
        if (rows.length) return { table: headerDiv.parentElement, rows };
      }
      return null;
    }

    async function goToFirstPage(table) {
      if (!table) return;
      let root = table.parentElement;
      let prev = null;
      for (let depth = 0; root && depth < 6 && !prev; depth++, root = root.parentElement) {
        prev = [...root.querySelectorAll('button, [role="button"]')].find(button => !isOurs(button) &&
          !table.contains(button) && visible(button) &&
          (/prev|previous|предыдущ|назад/i.test(button.getAttribute('aria-label') || button.title || '') ||
           /chevron-left|arrow-left/i.test(svgClasses(button))));
      }
      let guard = 0;
      while (prev && !prev.disabled && prev.getAttribute('aria-disabled') !== 'true' && guard++ < 30) {
        prev.click();
        await sleep(350);
      }
    }

    async function collectTags(progress) {
      const initial = findTagsRows();
      if (!initial) throw new Error('Таблица тегов не найдена');
      await goToFirstPage(initial.table);

      const items = [];
      const seenNames = new Set();
      for (let page = 1; page <= 50; page++) {
        const found = findTagsRows();
        if (!found) break;
        await waitStable(() => textOf(found.table.querySelector('tbody, [role="rowgroup"]') || found.table), { timeout: 5000 });
        for (let index = 0; index < found.rows.length; index++) {
          const currentFound = findTagsRows();
          const row = currentFound?.rows[index];
          if (!row) break;
          const cellNodes = cellsOf(row);
          let name = '';
          let description = '';
          if (cellNodes.length >= 2) {
            name = textOf(cellNodes[0]).trim();
            description = textOf(cellNodes[1]).trim();
          } else {
            const nameEl = row.querySelector('a, strong, [class*="font-semibold" i], [class*="font-medium" i]');
            name = nameEl ? textOf(nameEl).trim() : firstLine(row);
            description = textOf(row).replace(name, '').replace(/[\r\n]+/g, ' ').trim();
          }
          if (!name || seenNames.has(name.toLowerCase())) continue;
          seenNames.add(name.toLowerCase());
          progress(`Тег ${items.length + 1}: ${name}`);
          items.push({ name, description });
        }
        progress(`Страница ${page}: собрано ${items.length} тегов…`);
        const hasNext = await nextPage(found.table);
        if (!hasNext) break;
        await sleep(500);
      }
      if (!items.length) throw new Error('Теги не найдены в таблице Tagging Agent');
      return items;
    }

    /* ---------- ZIP без библиотек (метод «store», имена в UTF-8) ---------- */

    const CRC_TABLE = (() => {
      const table = new Uint32Array(256);
      for (let n = 0; n < 256; n++) {
        let c = n;
        for (let k = 0; k < 8; k++) c = c & 1 ? 0xEDB88320 ^ (c >>> 1) : c >>> 1;
        table[n] = c >>> 0;
      }
      return table;
    })();

    function crc32(bytes) {
      let crc = 0xFFFFFFFF;
      for (let i = 0; i < bytes.length; i++) crc = CRC_TABLE[(crc ^ bytes[i]) & 0xFF] ^ (crc >>> 8);
      return (crc ^ 0xFFFFFFFF) >>> 0;
    }

    function makeZip(files) {
      const encoder = new TextEncoder();
      const now = new Date();
      const dosTime = (now.getHours() << 11) | (now.getMinutes() << 5) | (now.getSeconds() >> 1);
      const dosDate = ((now.getFullYear() - 1980) << 9) | ((now.getMonth() + 1) << 5) | now.getDate();
      const chunks = [];
      const central = [];
      let offset = 0;
      for (const file of files) {
        const name = encoder.encode(file.path);
        const data = encoder.encode(file.content);
        const crc = crc32(data);
        const local = new DataView(new ArrayBuffer(30));
        local.setUint32(0, 0x04034b50, true);
        local.setUint16(4, 20, true);
        local.setUint16(6, 0x0800, true); // UTF-8 имена
        local.setUint16(10, dosTime, true);
        local.setUint16(12, dosDate, true);
        local.setUint32(14, crc, true);
        local.setUint32(18, data.length, true);
        local.setUint32(22, data.length, true);
        local.setUint16(26, name.length, true);
        chunks.push(local, name, data);

        const entry = new DataView(new ArrayBuffer(46));
        entry.setUint32(0, 0x02014b50, true);
        entry.setUint16(4, 20, true);
        entry.setUint16(6, 20, true);
        entry.setUint16(8, 0x0800, true);
        entry.setUint16(12, dosTime, true);
        entry.setUint16(14, dosDate, true);
        entry.setUint32(16, crc, true);
        entry.setUint32(20, data.length, true);
        entry.setUint32(24, data.length, true);
        entry.setUint16(28, name.length, true);
        entry.setUint32(42, offset, true);
        central.push(entry, name);
        offset += 30 + name.length + data.length;
      }
      const centralSize = central.reduce((sum, part) => sum + part.byteLength, 0);
      const end = new DataView(new ArrayBuffer(22));
      end.setUint32(0, 0x06054b50, true);
      end.setUint16(8, files.length, true);
      end.setUint16(10, files.length, true);
      end.setUint32(12, centralSize, true);
      end.setUint32(16, offset, true);
      return new Blob([...chunks, ...central, end], { type: 'application/zip' });
    }

    /* ---------- Файлы архива ---------- */

    const safeFile = name => String(name).replace(/[\\/:*?"<>|\u0000-\u001f]+/g, '_').replace(/\s+/g, ' ').trim().slice(0, 120) || 'file';
    const fence = text => {
      const longest = Math.max(2, ...(String(text).match(/`+/g) || []).map(run => run.length));
      return '`'.repeat(longest + 1);
    };
    const prettyJson = text => {
      try { return JSON.stringify(JSON.parse(text), null, 2); } catch (_) { return text; }
    };
    const isSchema = label => /schema|схем/i.test(label);
    const uniquePath = () => {
      const used = new Set();
      return path => {
        let candidate = path;
        for (let n = 2; used.has(candidate.toLowerCase()); n++) candidate = path.replace(/(\.[^.]+)?$/, ` (${n})$1`);
        used.add(candidate.toLowerCase());
        return candidate;
      };
    };

    function buildFiles(data) {
      const unique = uniquePath();
      const files = [];
      const md = [`# Экспорт: ${data.tenant.name}`, '',
        `- Product Id: ${data.tenant.id}`, `- Агент: ${data.tenant.agent || DEFAULT_AGENT}`,
        `- Дата экспорта: ${new Date().toLocaleString('ru-RU')}`, ''];
      const { documents, tags, prompts, functions } = data.sections;

      if (documents) {
        md.push(`## Knowledge Base (${documents.items.length})`, '');
        for (const doc of documents.items) {
          const fileName = /\.[a-z0-9]{1,5}$/i.test(doc.name) ? doc.name : `${doc.name}.txt`;
          files.push({ path: unique(`Knowledge Base/${safeFile(fileName)}`), content: doc.content });
          md.push(`### ${doc.name}`, '');
          for (const [key, value] of Object.entries(doc.meta || {})) md.push(`- ${key}: ${value}`);
          if (doc.error) md.push(`- ⚠ Ошибка: ${doc.error}`);
          const f = fence(doc.content);
          md.push('', f, doc.content, f, '');
        }
      }

      if (tags) {
        md.push(`## Теги (${tags.items.length})`, '');
        const lines = [];
        for (const tag of tags.items) {
          lines.push(`## ${tag.name}`, '', tag.description, '');
          md.push(`### ${tag.name}`, '', tag.description, '');
          files.push({ path: unique(`tags/${safeFile(tag.name)}.txt`), content: `${tag.name}\n\n${tag.description}` });
        }
        files.push({ path: unique('Tags.txt'), content: lines.join('\n') });
        files.push({ path: unique('tags.json'), content: JSON.stringify(tags.items, null, 2) });
      }

      if (prompts) {
        md.push(`## Промпты (${prompts.items.length})`, '');
        for (const prompt of prompts.items) {
          const single = prompt.fields.length === 1;
          const body = single ? prompt.fields[0].value
            : prompt.fields.map(field => `### ${field.label}\n\n${field.value}`).join('\n\n');
          files.push({ path: unique(`prompts/${safeFile(prompt.name)}.txt`), content: body });
          md.push(`### ${prompt.name}`, '');
          for (const [key, value] of Object.entries(prompt.meta || {})) md.push(`- ${key}: ${value}`);
          if (prompt.error) md.push(`- ⚠ Ошибка: ${prompt.error}`);
          if (Object.keys(prompt.meta || {}).length || prompt.error) md.push('');
          for (const field of prompt.fields) {
            if (!single) md.push(`**${field.label}**`, '');
            const f = fence(field.value);
            md.push(f, field.value, f, '');
          }
        }
      }

      if (functions) {
        md.push(`## Функции (${functions.items.length})`, '');
        for (const fn of functions.items) {
          // В файл функции — только название, описание и схема. Остальное не сохраняем.
          const pick = re => fn.fields.find(field => re.test(field.label))?.value;
          const tableDescription = Object.entries(fn.table || {})
            .find(([key]) => /description|описан/i.test(key))?.[1];
          const name = pick(/function\s*name|^name$|назван/i) || fn.name;
          const description = pick(/description|описан/i) ?? tableDescription ?? '';
          const schemas = fn.fields.filter(field => isSchema(field.label));

          const parts = ['## Function name', '', name, '', '## Description', '', description];
          for (const schema of schemas) parts.push('', `## ${schema.label}`, '', prettyJson(schema.value));
          files.push({ path: unique(`functions/${safeFile(fn.name)}.txt`), content: parts.join('\n') });

          md.push(`### ${name}`, '');
          if (fn.error) md.push(`⚠ Ошибка сбора: ${fn.error}`, '');
          const fd = fence(description);
          md.push('**Description**', '', fd, description, fd, '');
          for (const schema of schemas) {
            const json = prettyJson(schema.value);
            const fs = fence(json);
            md.push(`**${schema.label}**`, '', `${fs}json`, json, fs, '');
          }
        }
      }

      files.unshift({ path: 'ВСЁ_В_ОДНОМ.md', content: md.join('\n') });
      return files;
    }

    function download() {
      const data = loadData();
      if (!Object.keys(data.sections).length) return setStatus('Пока нечего скачивать — соберите хотя бы один раздел.', true);
      const blob = makeZip(buildFiles(data));
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      const agent = agentName() === DEFAULT_AGENT ? '' : ` – ${safeFile(agentName())}`;
      link.download = `${safeFile(tenant.name)}${agent} – ${new Date().toISOString().slice(0, 10)}.zip`;
      document.body.append(link);
      link.click();
      link.remove();
      setTimeout(() => URL.revokeObjectURL(url), 2000);
      setStatus('ZIP скачан.');
    }

    /* ---------- Диагностика (если раздел не распознан) ---------- */

    function skeleton(node, depth = 0, out = []) {
      if (depth > 16 || out.length > 2000 || isOurs(node)) return out;
      const attrs = ['role', 'aria-label', 'aria-expanded', 'aria-haspopup', 'data-testid', 'type', 'aria-selected', 'data-state']
        .map(name => node.getAttribute?.(name) ? `${name}="${node.getAttribute(name)}"` : '').filter(Boolean);
      const rawClass = node.getAttribute?.('class') || '';
      const cls = rawClass.split(/\s+/).filter(Boolean).slice(0, 3).join('.');
      const own = node.tagName === 'TEXTAREA' ? '' : [...node.childNodes].filter(child => child.nodeType === 3)
        .map(child => child.nodeValue.trim()).join(' ').slice(0, 40);
      out.push(`${'  '.repeat(depth)}<${node.tagName.toLowerCase()}${cls ? '.' + cls : ''}${attrs.length ? ' ' + attrs.join(' ') : ''}>${own ? ' ' + own : ''}`);
      if (node.tagName === 'svg') return out;
      for (const child of node.children) skeleton(child, depth + 1, out);
      return out;
    }

    async function copyDiagnostics() {
      const text = [`URL: ${location.origin}${location.pathname}`, `Раздел: ${detectSection() || '—'}`,
        ...skeleton(document.body)].join('\n');
      try {
        await navigator.clipboard.writeText(text);
        setStatus('Структура страницы (без значений полей) скопирована.');
      } catch (_) {
        setStatus('Не удалось скопировать структуру.', true);
      }
    }

    /* ---------- Виджет ---------- */

    const WIDGET_CSS = `
#emtf-export { position: fixed !important; right: 18px !important; bottom: 18px !important; z-index: 2147483645 !important;
  width: 340px !important; color: #e9edff !important; background: #2b2f48 !important;
  border: 1px solid #4a5175 !important; border-radius: 12px !important; box-shadow: 0 12px 34px rgba(0,0,0,.4) !important;
  font: 13px/1.4 ${FONT} !important; }
#emtf-export * { box-sizing: border-box !important; font-family: inherit !important; margin: 0 !important; text-transform: none !important; letter-spacing: normal !important; }
#emtf-export[data-collapsed="true"] { width: auto !important; border-radius: 22px !important; }
#emtf-export[data-collapsed="true"] .x-body { display: none !important; }
#emtf-export .x-head { display: flex !important; align-items: center !important; gap: 8px !important; padding: 9px 10px 9px 13px !important; cursor: move !important; user-select: none !important; touch-action: none !important; }
#emtf-export .x-head strong { flex: 1 !important; font-size: 13px !important; white-space: nowrap !important; overflow: hidden !important; text-overflow: ellipsis !important; }
#emtf-export[data-collapsed="true"] .x-head { padding: 9px 14px !important; }
#emtf-export .x-body { padding: 0 12px 12px !important; display: grid !important; gap: 8px !important; }
#emtf-export .x-row { display: flex !important; align-items: center !important; gap: 8px !important; padding: 6px 8px !important; border-radius: 8px !important; background: #33385a !important; }
#emtf-export .x-row.current { outline: 1px solid #f9b4c0 !important; }
#emtf-export .x-row .x-name { flex: 1 !important; white-space: nowrap !important; display: flex !important; align-items: center !important; gap: 7px !important; cursor: pointer !important; }
#emtf-export .x-row .x-name input { width: 15px !important; height: 15px !important; accent-color: #f04a61 !important; cursor: pointer !important; }
#emtf-export .x-row:has(input:not(:checked)) .x-name { color: #8f9abf !important; }
#emtf-export .x-row small { color: #a9b4d8 !important; font-size: 11px !important; white-space: nowrap !important; }
#emtf-export .x-actions button { white-space: nowrap !important; }
#emtf-export .x-row.done small { color: #8be0a1 !important; }
#emtf-export button { border: 1px solid #5d6585 !important; background: #414864 !important; color: #f5f6ff !important;
  border-radius: 7px !important; padding: 5px 10px !important; font-size: 12px !important; font-weight: 600 !important; cursor: pointer !important; min-height: 0 !important; box-shadow: none !important; }
#emtf-export button:not(.x-link):hover:not(:disabled) { background: #50597c !important; }
#emtf-export button:disabled { opacity: .45 !important; cursor: default !important; }
#emtf-export button.primary { background: #ed3e51 !important; border-color: #ed3e51 !important; }
#emtf-export button.icon { padding: 2px 7px !important; background: transparent !important; border-color: transparent !important; }
#emtf-export .x-actions { display: flex !important; gap: 6px !important; flex-wrap: wrap !important; }
#emtf-export .x-actions .primary { flex: 1 !important; }
#emtf-export .x-status { color: #b9c3e7 !important; font-size: 12px !important; min-height: 16px !important; overflow-wrap: anywhere !important; }
#emtf-export .x-status.error { color: #ff9eaa !important; }
#emtf-export .x-hint { color: #8f9abf !important; font-size: 11px !important; }
#emtf-export button.x-link { background: none !important; border: 0 !important; padding: 0 !important; color: #8f9abf !important; font-weight: 400 !important; text-decoration: underline !important; }`;

    function setStatus(text, error = false) {
      if (!els.status) return;
      els.status.textContent = text;
      els.status.classList.toggle('error', error);
    }

    function render() {
      if (!widget || !tenant) return;
      const data = loadData();
      const current = detectSection();
      const inAgent = Boolean(menuRoot());
      els.title.textContent = `⬇ Экспорт: ${tenant.name} · ${agentName()}`;
      for (const key of Object.keys(SECTION_NAMES)) {
        const row = els.rows[key];
        row.querySelector('input').disabled = running;
        const section = data.sections[key];
        row.classList.toggle('current', current === key);
        row.classList.toggle('done', Boolean(section));
        const errors = section?.items.filter(item => item.error).length || 0;
        row.querySelector('small').textContent = section
          ? `✓ ${section.items.length}${errors ? `, ошибок: ${errors}` : ''}`
          : (current === key ? 'открыт' : '—');
        row.querySelector('button').disabled = running || current !== key;
      }
      els.download.disabled = running || !Object.keys(data.sections).length;
      els.all.disabled = running;
      els.clear.disabled = running;
      els.stop.hidden = !running;
      els.hint.textContent = inAgent
        ? '«Собрать всё» пройдёт Knowledge, Prompts, Functions и Tags. Или собирайте по одному кнопками «Собрать».'
        : 'Откройте Agents → Answer Agent или Tagging Agent. «Собрать всё» может открыть нужные разделы сам.';
    }

    /* ---------- «Собрать всё»: сам переходит по разделам ---------- */

    async function goTo(section) {
      if (detectSection() === section) return;

      if (section === 'tags') {
        const agentsNav = findLeaves(['Agents']).find(l => l.closest('header, nav, [class*="breadcrumb" i]'));
        if (agentsNav) {
          safeClick(agentsNav);
          await sleep(600);
        }
        const tagAgentLeaf = findLeaves(['Tagging Agent', 'Tagging'], { inTables: true })[0];
        if (tagAgentLeaf) {
          safeClick(tagAgentLeaf.closest('a, button, [role="button"], tr') || tagAgentLeaf);
          if (await waitFor(() => detectSection() === 'tags', 12000)) {
            await sleep(600);
            return;
          }
        }
        if (detectSection() === 'tags') return;
        throw new Error('Не удалось открыть Tagging Agent → Теги');
      }

      // Для остальных разделов (documents, prompts, functions) открываем Answer Agent
      if (!menuRoot() || detectSection() === 'tags') {
        const agentsNav = findLeaves(['Agents']).find(l => l.closest('header, nav, [class*="breadcrumb" i]'));
        if (agentsNav) {
          safeClick(agentsNav);
          await sleep(600);
        }
        await openAgent();
      }

      if (detectSection() === section) return;
      // Prompts может быть группой: первый клик раскрывает её, второй открывает Conversation.
      for (let attempt = 0; attempt < 3; attempt++) {
        const item = navItem(section);
        if (!item) break;
        safeClick(item);
        if (await waitFor(() => detectSection() === section, attempt ? 15000 : 8000)) {
          await sleep(700);
          return;
        }
      }
      if (!navItem(section)) throw new Error(`Не найден пункт меню «${NAV_LABELS[section]?.[0] || section}»`);
      throw new Error(`Раздел «${SECTION_NAMES[section]}» не открылся`);
    }

    const COLLECTORS = {
      documents: collectDocuments,
      prompts: collectPrompts,
      functions: collectFunctions,
      tags: collectTags
    };

    // Какие разделы входят в «Собрать всё» (переключатели в панели).
    function enabledSections() {
      const saved = gmRead(ENABLED_KEY) || {};
      return Object.keys(COLLECTORS).filter(key => saved[key] !== false);
    }
    function setEnabled(key, value) {
      gmWrite(ENABLED_KEY, { ...(gmRead(ENABLED_KEY) || {}), [key]: value });
    }

    function savePending(queue) {
      if (queue.length) gmWrite(PENDING_KEY, { tenantId: tenant.id, agent: agentName(), queue, at: Date.now() });
      else gmWrite(PENDING_KEY, null);
    }

    async function runAll(queue = null) {
      if (running) return;
      if (!queue) {
        queue = enabledSections();
        if (!queue.length) return setStatus('Отметьте галочками хотя бы один раздел.', true);
        if (!window.confirm(`Скрипт сам откроет: ${queue.map(key => SECTION_NAMES[key]).join(', ')} — соберёт и скачает ZIP.\n` +
            'Не трогайте страницу, пока идёт сбор. Несохранённые правки в промптах могут сброситься.\n\nНачать?')) return;
        saveData({ tenant, sections: {} });
      }
      running = true;
      stopRequested = false;
      widget.dataset.collapsed = 'false';
      render();
      try {
        while (queue.length) {
          const section = queue[0];
          setStatus(`Открываю ${SECTION_NAMES[section]}…`);
          savePending(queue); // если страница перезагрузится — продолжим с этого места
          await goTo(section);
          const items = await COLLECTORS[section](text => setStatus(text), { confirmed: true });
          const data = loadData();
          data.sections[section] = { collectedAt: new Date().toISOString(), items };
          saveData(data);
          queue = queue.slice(1);
          savePending(queue);
          render();
        }
        const data = loadData();
        const errors = Object.values(data.sections).flatMap(section => section.items).filter(item => item.error).length;
        download();
        setStatus(`Готово, ZIP скачан${errors ? `. Ошибок: ${errors} — подробности в ВСЁ_В_ОДНОМ.md` : ''}.`, errors > 0);
      } catch (err) {
        savePending([]);
        setStatus(err.message || String(err), true);
      } finally {
        running = false;
        render();
      }
    }

    async function run(section) {
      if (running) return;
      running = true;
      stopRequested = false;
      render();
      try {
        const items = await COLLECTORS[section](text => setStatus(text));
        const data = loadData();
        data.sections[section] = { collectedAt: new Date().toISOString(), items };
        saveData(data);
        const errors = items.filter(item => item.error).length;
        setStatus(`${SECTION_NAMES[section]}: собрано ${items.length}${errors ? `, с ошибками: ${errors}` : ''}.`, errors > 0);
      } catch (err) {
        setStatus(err.message || String(err), true);
      } finally {
        running = false;
        render();
      }
    }

    function placeWidget(left, top) {
      const rect = widget.getBoundingClientRect();
      const maxLeft = Math.max(0, window.innerWidth - rect.width);
      const maxTop = Math.max(0, window.innerHeight - Math.min(rect.height, 44));
      widget.style.setProperty('left', `${Math.min(Math.max(0, left), maxLeft)}px`, 'important');
      widget.style.setProperty('top', `${Math.min(Math.max(0, top), maxTop)}px`, 'important');
      widget.style.setProperty('right', 'auto', 'important');
      widget.style.setProperty('bottom', 'auto', 'important');
    }

    // Развёрнутая панель не должна уезжать за край экрана.
    function keepInView() {
      if (!widget?.isConnected || !widget.style.top) return;
      const rect = widget.getBoundingClientRect();
      const top = rect.bottom > window.innerHeight ? window.innerHeight - rect.height - 8 : rect.top;
      placeWidget(rect.left, top);
    }
    window.addEventListener('resize', () => keepInView());

    function build() {
      if (!document.getElementById('emtf-export-style')) {
        const style = document.createElement('style');
        style.id = 'emtf-export-style';
        style.textContent = WIDGET_CSS;
        (document.head || document.documentElement).append(style);
      }
      widget = document.createElement('section');
      widget.id = 'emtf-export';
      widget.dataset.collapsed = String(gmRead('emtf_export_collapsed') !== false);
      const head = document.createElement('div');
      head.className = 'x-head';
      els.title = document.createElement('strong');
      const toggle = document.createElement('button');
      toggle.className = 'icon';
      toggle.type = 'button';
      toggle.textContent = '▾';
      head.append(els.title, toggle);
      head.title = 'Нажмите — свернуть/развернуть, тяните — переместить';

      // Перетаскивание панели за заголовок; короткий клик — свернуть/развернуть.
      let drag = null;
      head.addEventListener('pointerdown', event => {
        if (event.button !== 0) return;
        const rect = widget.getBoundingClientRect();
        drag = { x: event.clientX, y: event.clientY, dx: event.clientX - rect.left, dy: event.clientY - rect.top, moved: false };
        head.setPointerCapture(event.pointerId);
      });
      head.addEventListener('pointermove', event => {
        if (!drag) return;
        if (!drag.moved && Math.hypot(event.clientX - drag.x, event.clientY - drag.y) < 5) return;
        drag.moved = true;
        placeWidget(event.clientX - drag.dx, event.clientY - drag.dy);
      });
      const finish = () => {
        if (!drag) return;
        if (drag.moved) {
          const rect = widget.getBoundingClientRect();
          gmWrite(POSITION_KEY, { left: Math.round(rect.left), top: Math.round(rect.top) });
        } else {
          const collapsed = widget.dataset.collapsed !== 'true';
          widget.dataset.collapsed = String(collapsed);
          gmWrite('emtf_export_collapsed', collapsed);
          requestAnimationFrame(keepInView);
        }
        drag = null;
      };
      head.addEventListener('pointerup', finish);
      head.addEventListener('pointercancel', () => { drag = null; });

      const body = document.createElement('div');
      body.className = 'x-body';
      els.rows = {};
      for (const [key, name] of Object.entries(SECTION_NAMES)) {
        const row = document.createElement('div');
        row.className = 'x-row';
        const label = document.createElement('label');
        label.className = 'x-name';
        label.title = 'Включать в «Собрать всё»';
        const checkbox = document.createElement('input');
        checkbox.type = 'checkbox';
        checkbox.checked = enabledSections().includes(key);
        checkbox.addEventListener('change', () => setEnabled(key, checkbox.checked));
        label.append(checkbox, document.createTextNode(name));
        const info = document.createElement('small');
        const button = document.createElement('button');
        button.type = 'button';
        button.textContent = 'Собрать';
        button.title = 'Собрать этот раздел (он должен быть открыт)';
        button.addEventListener('click', () => run(key));
        row.append(label, info, button);
        els.rows[key] = row;
        body.append(row);
      }
      const actions = document.createElement('div');
      actions.className = 'x-actions';
      els.all = Object.assign(document.createElement('button'), { type: 'button', className: 'primary', textContent: '⬇ Собрать всё' });
      els.all.addEventListener('click', () => runAll());
      els.download = Object.assign(document.createElement('button'), { type: 'button', textContent: 'Скачать ZIP' });
      els.download.addEventListener('click', download);
      els.stop = Object.assign(document.createElement('button'), { type: 'button', textContent: 'Стоп' });
      els.stop.addEventListener('click', () => { stopRequested = true; });
      els.clear = Object.assign(document.createElement('button'), { type: 'button', textContent: 'Очистить' });
      els.clear.addEventListener('click', () => {
        if (!window.confirm('Удалить собранные данные этого агента (только из экспорта)?')) return;
        saveData({ tenant, sections: {} });
        setStatus('Собранные данные очищены.');
        render();
      });
      actions.append(els.all, els.download, els.stop, els.clear);
      els.status = document.createElement('div');
      els.status.className = 'x-status';
      els.hint = document.createElement('div');
      els.hint.className = 'x-hint';
      const diag = Object.assign(document.createElement('button'), {
        type: 'button', className: 'x-link', textContent: 'Не работает? Скопировать структуру страницы'
      });
      diag.addEventListener('click', copyDiagnostics);
      body.append(actions, els.status, els.hint, diag);
      widget.append(head, body);
      document.body.append(widget);
      const saved = gmRead(POSITION_KEY);
      if (saved && Number.isFinite(saved.left) && Number.isFinite(saved.top)) placeWidget(saved.left, saved.top);
      requestAnimationFrame(keepInView);
    }

    /* ---------- Автозаполнение из Chatwoot (Handoff) ---------- */

    function rememberTenant(t) {
      if (!t?.name || t.name === t.id) return;
      const map = gmRead(TENANT_MAP_KEY) || {};
      const norm = normalizeTitle(t.name);
      if (norm) {
        map[norm] = { id: t.id, name: t.name, url: location.href, at: Date.now() };
        gmWrite(TENANT_MAP_KEY, map);
      }
    }

    function rememberCardTenants() {
      const grid = findGrid();
      if (!grid) return;
      const map = gmRead(TENANT_MAP_KEY) || {};
      let changed = false;
      for (const card of grid.container.children) {
        const title = titleOf(card);
        const href = cardLink(card)?.getAttribute('href') || '';
        const m = href.match(/\/tenants\/([0-9a-f-]+)/i);
        if (title && m) {
          const norm = normalizeTitle(title);
          if (!map[norm] || map[norm].id !== m[1]) {
            map[norm] = { id: m[1], name: title, url: location.origin + href, at: Date.now() };
            changed = true;
          }
        }
      }
      if (changed) gmWrite(TENANT_MAP_KEY, map);
    }

    function setNativeValue(element, value) {
      const prototype = element instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
      const descriptor = Object.getOwnPropertyDescriptor(prototype, 'value');
      if (descriptor && descriptor.set) {
        descriptor.set.call(element, value);
      } else {
        element.value = value;
      }
      element.dispatchEvent(new Event('input', { bubbles: true }));
      element.dispatchEvent(new Event('change', { bubbles: true }));
    }

    let echoToastTimer = 0;
    function showEchoMindToast(text, isError = false) {
      let toast = document.getElementById('emtf-toast');
      if (!toast) {
        toast = document.createElement('div');
        toast.id = 'emtf-toast';
        toast.style.cssText = `
          position: fixed !important;
          right: 24px !important;
          bottom: 24px !important;
          z-index: 9999999 !important;
          background: #2b2f48 !important;
          color: #e9edff !important;
          border: 1px solid #4a5175 !important;
          border-radius: 10px !important;
          padding: 12px 18px !important;
          font: 13px/1.4 Inter, system-ui, -apple-system, sans-serif !important;
          box-shadow: 0 10px 30px rgba(0,0,0,0.5) !important;
          transition: all 0.2s ease-out !important;
        `;
        document.body.append(toast);
      }
      toast.style.background = isError ? '#594051' : '#2b2f48';
      toast.style.borderColor = isError ? '#ab5e70' : '#4a5175';
      toast.style.color = isError ? '#ffc7cf' : '#e9edff';
      toast.textContent = text;
      toast.style.display = 'block';
      clearTimeout(echoToastTimer);
      echoToastTimer = setTimeout(() => {
        if (toast) toast.style.display = 'none';
      }, 4500);
    }

    let handoffRunning = false;
    async function processHandoff() {
      const handoff = gmRead(HANDOFF_KEY);
      if (!handoff) return;
      if (!handoff.conversationId || !handoff.dialog) {
        gmWrite(HANDOFF_KEY, null);
        return;
      }
      if (Date.now() - (handoff.at || 0) > HANDOFF_TTL) {
        gmWrite(HANDOFF_KEY, null);
        return;
      }
      if (handoffRunning) return;
      handoffRunning = true;

      try {
        const curTenant = detectTenant();
        if (curTenant) rememberTenant(curTenant);

        const tenantMap = gmRead(TENANT_MAP_KEY) || {};
        const rawTarget = handoff.tenantName || '';
        const targetTenantName = mapInboxToTenant(rawTarget);
        const normTarget = normalizeTitle(targetTenantName);

        // 1. Если находимся на списке продуктов/тенантов
        if (isTenantListing() && (!curTenant || !curTenant.id)) {
          showEchoMindToast(`Поиск тенанта «${targetTenantName}»…`);
          rememberCardTenants();
          const grid = findGrid();
          if (grid) {
            let matchingCard = [...grid.container.children].find(card => {
              const cardTitle = titleOf(card);
              const normCard = normalizeTitle(cardTitle);
              return normCard === normTarget ||
                     normalizeTitle(mapInboxToTenant(cardTitle)) === normTarget ||
                     normCard === normalizeTitle(mapInboxToTenant(rawTarget)) ||
                     normCard === normalizeTitle(rawTarget.replace(/[_\s]+/g, ' '));
            });
            if (!matchingCard && tenantMap[normTarget]?.id) {
              const cachedId = tenantMap[normTarget].id;
              matchingCard = [...grid.container.children].find(card => {
                const href = cardLink(card)?.getAttribute('href') || '';
                return href.includes(cachedId);
              });
            }
            if (!matchingCard) {
              // Запасной поиск: сопоставление с заменой префиксов crorebet/crore, 4rabet/4ra
              matchingCard = [...grid.container.children].find(card => {
                const cNorm = normalizeTitle(titleOf(card));
                const targetVariants = [
                  normTarget,
                  normTarget.replace(/\bcrorebet\b/g, 'crore'),
                  normTarget.replace(/\bcrore\b/g, 'crorebet'),
                  normTarget.replace(/\b4rabet\b/g, '4ra'),
                  normTarget.replace(/\b4ra\b/g, '4rabet'),
                  normalizeTitle(rawTarget.replace(/[_\s]+/g, ' '))
                ];
                return targetVariants.includes(cNorm);
              });
            }
            if (matchingCard) {
              showEchoMindToast(`Открываю «${titleOf(matchingCard)}»…`);
              const foundTenantName = titleOf(matchingCard);
              const foundId = (cardLink(matchingCard)?.getAttribute('href') || '').match(/\/tenants\/([0-9a-f-]+)/i)?.[1];
              if (foundId) {
                rememberTenant({ id: foundId, name: foundTenantName });
              }
              activateCard(matchingCard);
              return;
            } else {
              gmWrite(HANDOFF_KEY, null);
              showEchoMindToast(`Тенант «${targetTenantName}» не найден в списке`, true);
              return;
            }
          }
        }

        if (curTenant && normTarget) {
          const normCur = normalizeTitle(curTenant.name);
          const mappedCur = normalizeTitle(mapInboxToTenant(curTenant.name));
          const allowedNorms = new Set([
            normTarget,
            normalizeTitle(mapInboxToTenant(rawTarget)),
            normalizeTitle(rawTarget.replace(/[_\s]+/g, ' ')),
            normTarget.replace(/\bcrorebet\b/g, 'crore'),
            normTarget.replace(/\bcrore\b/g, 'crorebet'),
            normTarget.replace(/\b4rabet\b/g, '4ra'),
            normTarget.replace(/\b4ra\b/g, '4rabet')
          ]);
          const isSameTenant = allowedNorms.has(normCur) ||
            allowedNorms.has(mappedCur) ||
            (tenantMap[normTarget]?.id && tenantMap[normTarget].id === curTenant.id);
          if (!isSameTenant) {
            throw new Error(`Открыт тенант «${curTenant.name}», а нужен «${targetTenantName}»`);
          }
        }

        // 2. Навигация в Test prompts
        if (!isTestPromptsPage()) {
          showEchoMindToast('Перехожу в Answer Agent → Test prompts…');
          if (!menuRoot()) {
            const agentsNav = findLeaves(['Agents']).find(l => l.closest('header, nav'));
            if (agentsNav) {
              safeClick(agentsNav);
              await sleep(600);
            }
            await openAgent();
          }

          const testItem = navItem('test');
          if (!testItem) {
            throw new Error('Пункт «Test prompts» не найден в меню агента');
          }
          safeClick(testItem);

          const reached = await waitFor(() => isTestPromptsPage(), 10000);
          if (!reached) {
            throw new Error('Не удалось открыть страницу Test prompts');
          }
          await sleep(600);
        }

        // 3. Страница Test prompts открыта
        showEchoMindToast('Заполняю параметры и диалог…');

        const getParamContainer = () =>
          document.querySelector('.rounded-xl.border.bg-card.p-3') ||
          document.querySelector('[class*="rounded-xl"][class*="bg-card"]') ||
          document.querySelector('form.redesign-root') ||
          document.body;

        const idStr = String(handoff.conversationId).trim();

        const findChip = () => {
          const container = getParamContainer();
          const all = [...container.querySelectorAll('div, span')].filter(el => {
            return !isOurs(el) && !el.closest('textarea, input, label') && /conversation_id/i.test(textOf(el));
          });
          return all.find(el => el.querySelector('button, svg.lucide-x')) || all[0] || null;
        };

        const hasChipWithVal = () => {
          const container = getParamContainer();
          const txt = (container?.innerText || container?.textContent || '').trim();
          if (/conversation_id/i.test(txt) && txt.includes(idStr)) return true;
          const bodyTxt = (document.body?.innerText || document.body?.textContent || '').trim();
          return /conversation_id/i.test(bodyTxt) && bodyTxt.includes(idStr);
        };

        const oldChip = findChip();
        if (oldChip && !hasChipWithVal()) {
          const remove = oldChip.querySelector('button') ||
            oldChip.parentElement?.querySelector('button') ||
            [...getParamContainer().querySelectorAll('button')].find(b =>
              b.querySelector('svg.lucide-x') || /remove|close|×|x/i.test(b.getAttribute('aria-label') || b.textContent || '')
            );
          if (remove) {
            remove.click();
            await waitFor(() => !findChip(), 3000);
          }
        }

        if (!hasChipWithVal()) {
          // Проверяем поля ввода key/value
          let keyInput = document.querySelector('input[aria-label="Parameter key"], input[placeholder*="key" i]');
          let valInput = document.querySelector('input[aria-label="Parameter value"], input[placeholder*="value" i]');

          if (!keyInput || !valInput) {
            const addBtn = [...document.querySelectorAll('button')].find(b =>
              !isOurs(b) && !DANGER_RE.test(b.textContent || '') && /\+?\s*parameter/i.test(b.textContent || '')
            );
            if (!addBtn) {
              throw new Error('Кнопка «+ Parameter» не найдена');
            }
            addBtn.scrollIntoView({ block: 'center' });
            addBtn.click();
            await sleep(350);

            const inputsAppeared = await waitFor(() => {
              keyInput = document.querySelector('input[aria-label="Parameter key"], input[placeholder*="key" i]');
              valInput = document.querySelector('input[aria-label="Parameter value"], input[placeholder*="value" i]');
              return Boolean(keyInput && valInput);
            }, 5000);

            if (!inputsAppeared || !keyInput || !valInput) {
              throw new Error('Поля для ввода параметра (key/value) не появились');
            }
          }

          // Вводим conversation_id и ID
          setNativeValue(keyInput, 'conversation_id');
          setNativeValue(valInput, idStr);
          await sleep(150);

          // Нажимаем синюю галочку сохранения (Save parameter)
          const saveBtn = document.querySelector('button[aria-label="Save parameter"]') ||
            [...document.querySelectorAll('button')].find(b => b.querySelector('svg.lucide-check') && !b.getAttribute('aria-label')?.includes('Cancel'));
          if (!saveBtn) {
            throw new Error('Кнопка сохранения параметра (галочка) не найдена');
          }
          saveBtn.click();

          const confirmed = await waitFor(hasChipWithVal, 6000);
          if (!confirmed) {
            throw new Error('Параметр conversation_id не появился после подтверждения');
          }
        }

        // Вставляем диалог в textarea
        const textarea = document.querySelector('textarea[aria-label="Test text"], textarea[placeholder*="Run test" i], textarea.resize-y, textarea');
        if (!textarea) {
          throw new Error('Поле ввода диалога (Test text) не найдено');
        }

        setNativeValue(textarea, handoff.dialog);
        await sleep(150);

        if (textarea.value !== handoff.dialog) {
          textarea.value = handoff.dialog;
          textarea.dispatchEvent(new Event('input', { bubbles: true }));
          textarea.dispatchEvent(new Event('change', { bubbles: true }));
        }

        textarea.focus();
        textarea.scrollIntoView({ block: 'center' });

        // Успех! Очищаем payload
        gmWrite(HANDOFF_KEY, null);
        showEchoMindToast('Диалог вставлен. Проверьте и нажмите Run test');
      } catch (err) {
        gmWrite(HANDOFF_KEY, null);
        console.error('[EchoMind Tenant Groups] Ошибка при автозаполнении Test prompts:', err);
        showEchoMindToast(`Ошибка: ${err.message || err}`, true);
      } finally {
        handoffRunning = false;
      }
    }

    // Виджет показывается на страницах продукта (Agents / Answer Agent и его разделы).
    let checkTimer = 0;
    function check() {
      clearTimeout(checkTimer);
      checkTimer = setTimeout(() => {
        rememberCardTenants();
        const found = detectTenant();
        if (found) rememberTenant(found);

        const handoff = gmRead(HANDOFF_KEY);
        if (handoff && Date.now() - (handoff.at || 0) < HANDOFF_TTL) {
          processHandoff();
        }

        if (running) return render();
        if (!found) {
          widget?.remove();
          widget = null;
          tenant = null;
          return;
        }
        tenant = found;
        if (!widget || !widget.isConnected) build();
        render();
        const pending = gmRead(PENDING_KEY);
        if (pending?.tenantId === tenant.id && pending.queue?.length && Date.now() - pending.at < 10 * 60 * 1000) {
          if (pending.agent && !tenant.agent) tenant.agent = pending.agent;
          setTimeout(() => runAll(pending.queue), 800); // продолжаем после перезагрузки страницы
        }
      }, 300);
    }

    function openWidget() {
      check();
      setTimeout(() => {
        if (!widget) return window.alert('Откройте продукт → Agents → Answer Agent.');
        widget.dataset.collapsed = 'false';
        gmWrite('emtf_export_collapsed', false);
      }, 400);
    }

    return { check, openWidget };
  })();

  /* ======================= Запуск ======================= */

  if (typeof GM_registerMenuCommand === 'function') {
    GM_registerMenuCommand('⚙ Настроить группы тенантов', () => editor.open());
    GM_registerMenuCommand('◈ Свернуть / развернуть панель (Alt+P)', togglePanel);
    GM_registerMenuCommand('⬇ Экспорт тенанта', () => exporter.openWidget());
    GM_registerMenuCommand('◈ Скрыть / показать панель полностью', () =>
      setUi({ hidden: !state.config.ui.hidden, collapsed: false }));
  }

  if (typeof GM_addValueChangeListener === 'function') {
    GM_addValueChangeListener(HANDOFF_KEY, (_k, _o, newVal) => {
      if (newVal && typeof newVal === 'object') {
        exporter.check();
      }
    });
  }

  refresh();
  exporter.check();
  const observer = new MutationObserver(records => {
    if (records.some(record => !record.target.closest?.('#emtf-toolbar, #emtf-view, #emtf-editor-host, #emtf-export, #emtf-toast') &&
          (record.removedNodes.length > 0 ||
           [...record.addedNodes].some(node => node !== toolbar && node !== viewBox &&
             !['emtf-editor-host', 'emtf-export', 'emtf-toast'].includes(node.id))))) {
      scheduleRefresh();
      exporter.check();
    }
  });
  observer.observe(document.documentElement, { childList: true, subtree: true });
  window.addEventListener('popstate', () => { scheduleRefresh(); exporter.check(); });
  window.addEventListener('hashchange', scheduleRefresh);
  setTimeout(scheduleRefresh, 650);
  setTimeout(scheduleRefresh, 1800);
})();