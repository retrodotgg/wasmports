/* ============================================================================
 *  Загрузчик Unity WebGL — замена master-loader.js + unity-2020.js от Poki.
 *  Повторяет их поведение: те же пропорции контейнера, тот же порядок вызовов
 *  SDK, та же установка window.unityGame и флагов pokiReady / pokiAdBlock,
 *  на которые завязан initPokiBridge внутри игры.
 * ==========================================================================*/
(function () {
  'use strict';

  var cfg = window.config;
  var container, canvas, loader, fill, amount;

  /* ---------------------------------------- пропорции контейнера, как у Poki */
  function resize() {
    var w = window.innerWidth, h = window.innerHeight, r = w / h;
    container.style.width = w + 'px';
    container.style.height = h + 'px';
    if (r > cfg.maxRatio) container.style.width = (h * cfg.maxRatio) + 'px';
    else if (r < cfg.minRatio) container.style.height = (w / cfg.minRatio) + 'px';
    var box = container.getBoundingClientRect();
    container.style.marginLeft = (-0.5 * box.width) + 'px';
    container.style.marginTop = (-0.5 * box.height) + 'px';
  }

  function onProgress(p) {
    var pct = Math.round(p * 100);
    fill.style.width = pct + '%';
    amount.textContent = pct + '%' + (cfg.fileSize ? ' of ' + cfg.fileSize + 'MB' : '');
    window.PokiSDK.gameLoadingProgress({ percentageDone: p });
  }

  function start() {
    container = document.getElementById('game-container');
    canvas    = document.getElementById('game');
    loader    = document.getElementById('loader');
    fill      = document.getElementById('progress-fill');
    amount    = document.getElementById('progress-amount');

    window.addEventListener('resize', resize);
    window.addEventListener('focus', resize);

    // Ровно та же последовательность, что была у Poki: игра ждёт от моста
    // "ready" или "adblock", иначе не выходит из загрузочного экрана.
    window.PokiSDK.init().then(function () {
      if (window.pokiBridge) window.unityGame.SendMessage(window.pokiBridge, 'ready');
      else window.pokiReady = true;
    }).catch(function () {
      if (window.pokiBridge) window.unityGame.SendMessage(window.pokiBridge, 'adblock');
      else window.pokiAdBlock = true;
    });

    var m = cfg.metadata;
    cfg.dataUrl            = 'Build/' + m.data_filename;
    cfg.frameworkUrl       = 'Build/' + m.framework_filename;
    cfg.codeUrl            = 'Build/' + m.code_filename;
    cfg.streamingAssetsUrl = 'StreamingAssets';
    cfg.companyName        = m.company_name;
    cfg.productName        = m.product_name;
    cfg.productVersion     = m.product_version;

    var s = document.createElement('script');
    s.src = 'Build/' + m.loader_filename;
    s.addEventListener('load', function () {
      createUnityInstance(canvas, cfg, onProgress).then(function (instance) {
        window.unityGame = instance;
        container.style.display = 'block';
        loader.style.display = 'none';
        resize();
        window.PokiSDK.gameLoadingFinished();
      }).catch(function (e) { console.error(e); });
    });
    s.addEventListener('error', function () {
      amount.textContent = 'Failed to load the game';
    });
    document.body.appendChild(s);

    window.PokiSDK.gameLoadingStart();
    resize();
  }

  if (document.readyState === 'complete') start();
  else window.addEventListener('load', start);
})();
