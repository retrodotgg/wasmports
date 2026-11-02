/* ============================================================================
 *  GameMonetize bridge — Unity WebGL 2023.2 / бывший Poki-билд
 *  «Blacktop Police Chase»
 *
 *  Игра общается с площадкой через два уровня:
 *    1) framework.js дёргает глобальный  PokiSDK.*  (gameplayStart, displayAd…)
 *    2) framework.js дёргает  window.initPokiBridge / commercialBreak /
 *       rewardedBreak / shareableURL, а те шлют результат обратно в Unity
 *       через  window.unityGame.SendMessage(gameObject, method, arg)
 *
 *  Оба уровня воспроизведены один в один, чтобы не трогать код внутри wasm.
 *  Рекламная и телеметрическая интеграция отключена; вызовы игры безопасно
 *  завершаются через локальные заглушки без запросов к рекламным SDK.
 *  Грузиться должен ДО boot.js.
 * ==========================================================================*/
(function () {
  'use strict';

  /* ---------------------------------------------------------------- КОНФИГ */
  var CONFIG = {
    gameId: 'mhp35jy4xz6nx1fg8cdl4lpkyzlslgyp',

    // Poki дёргал преролл сам на gameLoadingFinished. У GameMonetize такого
    // нет, а IMA без настоящего жеста пользователя не стартует — поэтому
    // первый показ вешаем на первый жест после догрузки игры.
    startupAdOnFirstGesture: false,

    // Стартовый показ не состоялся (SDK не успел подняться, или площадка
    // держит свой интервал между роликами) — пробуем снова на очередном
    // действии игрока, но не чаще этого интервала, чтобы не долбить SDK.
    startupRetryThrottleMs: 8000,

    // Через сколько перестать добиваться стартового показа совсем.
    startupGiveUpMs: 300000,

    // Сколько ждать SDK_READY, прежде чем пометить SDK нерабочим, мс.
    // На сам показ не влияет — это только для диагностики.
    sdkReadyTimeout: 15000,

    // Сторож на случай, когда showBanner() вызван, но ролик так и не пошёл
    // (нет заливки, интервал площадки). Срабатывает ТОЛЬКО пока не пришёл
    // SDK_GAME_PAUSE: если ролик реально играет, ждём его до конца.
    noFillWatchdogMs: 4000,

    verbose: true
  };

  function log() {
    if (!CONFIG.verbose) return;
    console.log.apply(console, ['[GM]'].concat([].slice.call(arguments)));
  }

  /* ------------------------------------------------------------- СОСТОЯНИЕ */
  var sessionStart = Date.now();

  var sdkScriptLoaded = false;
  var sdkReady = false;
  var sdkFailed = false;

  var adIsPlaying = false;
  var adStartedAt = 0;
  var pendingResolve = null;
  var rewardEarned = false;
  var sawPause = false;

  var interstitialCount = 0;
  var rewardedCount = 0;
  var totalAdCount = 0;
  var platformAds = 0;

  var firstGestureDone = false;
  var loadingFinished = false;
  var startupAdDone = false;
  var startupAdRunning = false;
  var startupAttempts = 0;
  var lastStartupTry = 0;

  function sessionAge() { return (Date.now() - sessionStart) / 1000; }

  /* ------------------------------------------------------------ ЗВУК UNITY
   * WEBAudio наружу фреймворком не экспортируется, поэтому перехватываем сам
   * конструктор: _JS_Sound_Init делает `new AudioContext`, и контекст оседает
   * у нас. Работает независимо от версии Unity.
   * -----------------------------------------------------------------------*/
  var audioContexts = [];
  (function patchAudioContext() {
    var Native = window.AudioContext || window.webkitAudioContext;
    if (!Native || typeof Proxy === 'undefined') return;
    var Patched = new Proxy(Native, {
      construct: function (target, args) {
        var ctx = new target(args[0]);
        audioContexts.push(ctx);
        return ctx;
      }
    });
    window.AudioContext = Patched;
    window.webkitAudioContext = Patched;
  })();

  function muteGame() {
    audioContexts.forEach(function (c) {
      try { if (c.state === 'running') c.suspend(); } catch (e) {}
    });
  }
  function unmuteGame() {
    audioContexts.forEach(function (c) {
      try { if (c.state === 'suspended') c.resume(); } catch (e) {}
    });
  }

  /* ---------------------------------------------------- ПЕРВЫЙ ЖЕСТ ЮЗЕРА
   * Меню этой игры управляется клавиатурой, поэтому клика мыши может не быть
   * вообще. Ловим любое действие: мышь, тач, клавиши. Слушатели снимаем не
   * после первого события, а когда стартовый показ реально состоялся —
   * иначе один неудачный вызов (SDK ещё не готов, no fill) съедал бы его
   * навсегда.
   * -----------------------------------------------------------------------*/
  var GESTURES = ['pointerdown', 'mousedown', 'touchstart', 'keydown'];

  function onGesture() {
    if (!firstGestureDone) {
      firstGestureDone = true;
      log('первый жест пользователя получен');
      unmuteGame();
    }
    maybeStartupAd();
    // Стартовый слот закрыт и звук уже разбужен — слушатели больше не нужны.
    if (startupAdDone && firstGestureDone) unbindGestures();
  }

  function bindGestures() {
    GESTURES.forEach(function (t) {
      document.addEventListener(t, onGesture, { capture: true });
    });
  }
  function unbindGestures() {
    GESTURES.forEach(function (t) {
      document.removeEventListener(t, onGesture, { capture: true });
    });
  }
  bindGestures();

  function maybeStartupAd() {
    if (!CONFIG.startupAdOnFirstGesture) return;
    if (startupAdDone || startupAdRunning) return;

    if (sessionAge() * 1000 > CONFIG.startupGiveUpMs) {
      log('стартовый показ: сдаюсь, дальше только слоты самой игры');
      unbindGestures();
      return;
    }
    // Первая попытка — сразу. Последующие не чаще, чем раз в интервал,
    // иначе на каждом клике будет холостой вызов showBanner.
    if (startupAttempts > 0 && Date.now() - lastStartupTry < CONFIG.startupRetryThrottleMs) return;

    startupAttempts++;
    lastStartupTry = Date.now();
    startupAdRunning = true;
    log('стартовый показ, попытка ' + startupAttempts);

    runInterstitial().then(function (ok) {
      startupAdRunning = false;
      if (ok) {
        startupAdDone = true;
        unbindGestures();
        log('стартовый показ состоялся');
      } else {
        log('стартовый показ не прошёл, повторю на следующем действии игрока');
      }
    });
  }

  /* ------------------------------------------------------ ЗАВЕРШЕНИЕ ПОКАЗА */
  function finishAd() {
    // Флаг снимаем ДО проверки pendingResolve — иначе он залипает и
    // блокирует всю последующую рекламу.
    adIsPlaying = false;
    unmuteGame();
    if (!pendingResolve) return;
    var resolve = pendingResolve;
    pendingResolve = null;
    var ok = rewardEarned || sawPause;
    log(ok ? 'показ состоялся' : 'показ не состоялся (кулдаун / no fill)');
    resolve(ok);
  }

  function showGMAd() {
    return new Promise(function (resolve) {
      if (!firstGestureDone) { log('отказ: ещё не было действий игрока'); return resolve(false); }
      if (adIsPlaying) { log('отказ: показ уже идёт'); return resolve(false); }

      // Проверяем сам объект, а не событие SDK_READY: оно могло не долететь,
      // а showBanner при этом уже доступен. И наоборот — без объекта звать
      // нечего. Никаких ожиданий: если SDK не готов, выходим сразу и
      // попробуем на следующем действии игрока, чтобы жест был свежим.
      if (!window.sdk || typeof window.sdk.showBanner !== 'function') {
        log('отказ: SDK ещё не поднялся');
        return resolve(false);
      }

      adIsPlaying = true;
      adStartedAt = Date.now();
      rewardEarned = false;
      sawPause = false;
      pendingResolve = resolve;

      // Сторож только на случай «ролик не пошёл вовсе». Как только пришёл
      // SDK_GAME_PAUSE — реклама реально играет, и мы ждём SDK_GAME_START
      // сколько потребуется, хоть тридцать секунд.
      setTimeout(function () {
        if (adIsPlaying && !sawPause) {
          log('ролик не начался за ' + CONFIG.noFillWatchdogMs + ' мс — отпускаю игру');
          finishAd();
        }
      }, CONFIG.noFillWatchdogMs);

      log('вызываю sdk.showBanner()');
      try { window.sdk.showBanner(); }
      catch (e) { log('showBanner упал:', e); finishAd(); }
    });
  }

  /* -------------------------------------------------------------- СЛОТЫ */
  function runInterstitial() {
    interstitialCount++; totalAdCount++;
    log('interstitial #' + interstitialCount + ' | сессия ' + Math.round(sessionAge()) + 'с');
    return showGMAd();
  }

  function runRewarded() {
    rewardedCount++; totalAdCount++;
    log('rewarded #' + rewardedCount + ' | сессия ' + Math.round(sessionAge()) + 'с');
    return showGMAd();
  }

  /* ------------------------------------------------------- ШИМ window.PokiSDK
   * Ровно те методы, которые дёргает framework.js этой сборки.
   * -----------------------------------------------------------------------*/
  window.PokiSDK = {
    init: function () { return Promise.resolve(); },
    setDebug: function () {},

    gameLoadingStart: function () { log('gameLoadingStart'); },
    gameLoadingProgress: function () {},
    gameLoadingFinished: function () {
      log('gameLoadingFinished');
      loadingFinished = true;
    },

    gameplayStart: function () {},
    gameplayStop: function () {},
    happyTime: function () {},

    commercialBreak: function () { return Promise.resolve(); },
    rewardedBreak: function () { return Promise.resolve(false); },

    // Баннерных мест у GameMonetize нет — прячем контейнер, чтобы игра
    // не падала и не оставляла на экране пустую дырку.
    displayAd: function (container) { if (container) container.style.display = 'none'; },
    destroyAd: function () {},

    isAdBlocked: function () { return false; },
    customEvent: function () {},
    measure: function () {},
    logError: function (e) { console.warn('[game]', e); },

    getLanguage: function () { return (navigator.language || 'en').slice(0, 2); },
    getURLParam: function (name) {
      try { return new URLSearchParams(location.search).get(name) || ''; } catch (e) { return ''; }
    },

    shareableURL: function () { return Promise.resolve(location.href); },
    getUser: function () { return Promise.reject(); },
    getToken: function () { return Promise.reject(); },
    login: function () { return Promise.reject(); }
  };

  /* ------------------------------------------------------- МОСТ Unity ⇄ JS
   * Точная копия контракта Poki: имена методов SendMessage менять нельзя,
   * их слушает C#-код внутри wasm.
   * -----------------------------------------------------------------------*/
  var gameObjectName;

  window.initPokiBridge = function (name) {
    gameObjectName = name;
    if (!window.unityGame) { setTimeout(function () { window.initPokiBridge(name); }, 100); return; }
    if (window.pokiReady) window.unityGame.SendMessage(name, 'ready');
    else if (window.pokiAdBlock) window.unityGame.SendMessage(name, 'adblock');
    else window.pokiBridge = name;
  };

  window.commercialBreak = function () {
    window.PokiSDK.commercialBreak().then(function () {
      window.unityGame.SendMessage(gameObjectName, 'commercialBreakCompleted');
    });
  };

  window.rewardedBreak = function () {
    window.PokiSDK.rewardedBreak.apply(null, arguments).then(function (v) {
      window.unityGame.SendMessage(gameObjectName, 'rewardedBreakCompleted', (!!v).toString());
    });
  };

  window.shareableURL = function (json) {
    window.PokiSDK.shareableURL(json)
      .then(function (u) { window.unityGame.SendMessage(gameObjectName, 'shareableURLResolved', u); })
      .catch(function () { window.unityGame.SendMessage(gameObjectName, 'shareableURLRejected'); });
  };
  window.getUser = function () {
    window.PokiSDK.getUser()
      .then(function (u) { window.unityGame.SendMessage(gameObjectName, 'getUserResolved', JSON.stringify(u || {})); })
      .catch(function () { window.unityGame.SendMessage(gameObjectName, 'getUserRejected'); });
  };
  window.getToken = function () {
    window.PokiSDK.getToken()
      .then(function (t) { window.unityGame.SendMessage(gameObjectName, 'getTokenResolved', t || ''); })
      .catch(function () { window.unityGame.SendMessage(gameObjectName, 'getTokenRejected'); });
  };
  window.login = function () {
    window.PokiSDK.login()
      .then(function () { window.unityGame.SendMessage(gameObjectName, 'loginResolved'); })
      .catch(function () { window.unityGame.SendMessage(gameObjectName, 'loginRejected'); });
  };

  /* ---------------------------------------------------------- ДИАГНОСТИКА */
  window.__gm = function () {
    return {
      'gameId': CONFIG.gameId,
      'sdk.js загружен': sdkScriptLoaded,
      'window.sdk есть': !!window.sdk,
      'SDK_READY': sdkReady,
      'SDK провален': sdkFailed,
      'был жест': firstGestureDone,
      'игра догрузилась': loadingFinished,
      'стартовый показ отработал': startupAdDone,
      'попыток стартового показа': startupAttempts,
      'unityGame есть': !!window.unityGame,
      'мост Unity': gameObjectName || '(ещё не пришёл)',
      'сессия идёт, сек': Math.round(sessionAge()),
      'всего показов': totalAdCount,
      'показов от площадки': platformAds,
      'interstitial': interstitialCount,
      'rewarded': rewardedCount,
      'реклама идёт': adIsPlaying,
      'аудиоконтекстов перехвачено': audioContexts.length
    };
  };
})();
