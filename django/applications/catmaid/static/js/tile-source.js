/* -*- mode: espresso; espresso-indent-level: 2; indent-tabs-mode: nil -*- */
/* vim: set softtabstop=2 shiftwidth=2 tabstop=2 expandtab: */
/* global
 CATMAID,
 django_url,
 Stack,
 */

(function(CATMAID) {

  'use strict';

  /**
   * Get the part of the tile name that consists of invariant dimensions of the
   * slice plane: z, t, ...
   * For a 3D stack this will return 'z/', for a 4D stack 't/z/', etc.
   *
   * @param slicePixelPos stack pixel position for the slice plane [z, t, ...]
   */
  CATMAID.getTileBaseName = function (slicePixelPos) {
    var n = slicePixelPos.length;
    var dir = '';
    for (var i = n - 1; i >= 0; --i) {
      dir += slicePixelPos[i] + '/';
    }
    return dir;
  };

  /**
   * Create a canary tile URL for a particular project/stack/tileSource
   * combination.
   *
   * @param  {Project} project
   * @param  {Stack}   stack
   * @param  {Object}  tileSource
   * @return {String}  A complete canary tile URL
   */
  CATMAID.getTileSourceCanaryUrl = function (project, stack, tileSource) {
    var canaryLocation = stack.canaryLocation;
    var col = Math.floor(canaryLocation.x / tileSource.tileWidth);
    var row = Math.floor(canaryLocation.y / tileSource.tileHeight);
    return tileSource.getTileURL(project, stack, [canaryLocation.z], col, row, 0);
  };

  /**
   * Check whether the canary location for a stack is accessible via this tile
   * source and what time it takes to load. Checks for normal and CORS requests,
   * for DOM and WebGL tiles respectively.
   *
   * @param  {Project} project
   * @param  {Stack}   stack
   * @param  {Object}  tileSource
   * @param  {Boolean} noCache    Prevent caching by appending a dummy request parameter
   * @return {Object}             Object with boolean keys normal and cors as
   *                              well as float keys normalTime and corsTime.
   */
  CATMAID.checkTileSourceCanary = function (project, stack, tileSource, noCache) {
    var url = CATMAID.getTileSourceCanaryUrl(project, stack, tileSource);

    if (noCache) {
      url += "?nocache=" + Date.now();
    }

    var normalReq = new Promise(function (resolve, reject) {
      var normalImg = new Image();
      var beforeNormalLoad = performance.now();

      normalImg.onload = function () {
        resolve([true, performance.now() - beforeNormalLoad]);
      };
      normalImg.onerror = function () {
        resolve([false, Infinity]);
      };

      normalImg.src = url;
    });

    var beforeCorsLoad = performance.now();
    var corsReq = new Request(url, {
        mode: 'cors',
        credentials: 'same-origin',
        headers: tileSource.getRequestHeaders()});
    corsReq = fetch(corsReq)
      .then(function (response) {
        var contentHeader = response.headers.get('Content-Type');
        return [contentHeader && contentHeader.startsWith('image'),
            performance.now() - beforeCorsLoad];
      })
      .catch(function () { return [false, Infinity]; });

    return Promise.all([normalReq, corsReq]).then(function (result) {
      return {
        normal:     result[0][0],
        normalTime: result[0][1],
        cors:       result[1][0],
        corsTime:   result[1][1]
      };
    });
  };

  /**
   * Creates a new tile source, based on a source type.
   */
  CATMAID.getTileSource = function(tileSourceType, baseURL, fileExtension, tileWidth, tileHeight) {
    // Map tile source types to corresponding constructors. This could also be
    // represented as an array, but is this way more clear and readable.
    var tileSources = {
      '1': CATMAID.DefaultTileSource,
      '2': CATMAID.RequestTileSource,
      '3': CATMAID.HDF5TileSource,
      '4': CATMAID.BackslashTileSource,
      '5': CATMAID.LargeDataTileSource,
      '6': CATMAID.DVIDImageblkTileSource,
      '7': CATMAID.RenderServTileSource,
      '8': CATMAID.DVIDImagetileTileSource,
      '9': CATMAID.FlixServerTileSource,
      '10': CATMAID.BossTileSource
    };

    var TileSource = tileSources[tileSourceType];
    if (TileSource) {
      var source = new TileSource(baseURL, fileExtension, tileWidth, tileHeight);
      source.tileWidth = tileWidth;
      source.tileHeight = tileHeight;
      return source;
    } else throw new RangeError('Tile source type ' + tileSourceType + ' is unknown.');
  };


  CATMAID.AbstractTileSource = function (baseURL, fileExtension, tileWidth, tileHeight) {
    this.baseURL = baseURL;
    this.fileExtension = fileExtension;
    this.tileWidth = tileWidth;
    this.tileHeight = tileHeight;
    this.transposeTiles = new Set();
  };

  CATMAID.AbstractTileSource.prototype.constructor = CATMAID.AbstractTileSource;

  /**
   * Return the URL of a single tile, defined by it grid position
   * (x, y), ...
   */
  CATMAID.AbstractTileSource.prototype.getTileURL = function (
      project, stack, slicePixelPosition, col, row, zoomLevel) {
    throw new CATMAID.Error('Not implemented');
  };

  CATMAID.AbstractTileSource.prototype.getOverviewLayer = function (layer) {
    return new CATMAID.ArtificialOverviewLayer(layer);
  };

  CATMAID.AbstractTileSource.prototype.getSettings = function () {
    return this.settings || [];
  };

  CATMAID.AbstractTileSource.prototype.setSetting = function (name, value) {
    this[name] = value;
  };

  CATMAID.AbstractTileSource.prototype.getRequestHeaders = function () {
    return {};
  };


  CATMAID.AbstractTileSourceWithOverview = function () {
    CATMAID.AbstractTileSource.apply(this, arguments);
  };

  CATMAID.AbstractTileSourceWithOverview.prototype = Object.create(CATMAID.AbstractTileSource.prototype);

  CATMAID.AbstractTileSourceWithOverview.prototype.getOverviewURL = function (stack, slicePixelPosition) {
    throw new CATMAID.Error('Not implemented');
  };

  CATMAID.AbstractTileSourceWithOverview.prototype.getOverviewLayer = function (layer) {
    return new CATMAID.GenericOverviewLayer(layer, this.baseURL, this.fileExtension,
        this.getOverviewURL.bind(this));
  };


  /**
   * Creates URLs for standard tile path of CATMAID.
   *
   * Source type: 1
   */
  CATMAID.DefaultTileSource = function () {
    CATMAID.AbstractTileSourceWithOverview.apply(this, arguments);
  };

  CATMAID.DefaultTileSource.prototype = Object.create(CATMAID.AbstractTileSourceWithOverview.prototype);

  CATMAID.DefaultTileSource.prototype.getTileURL = function(
      project, stack, slicePixelPosition, col, row, zoomLevel) {
    var baseName = CATMAID.getTileBaseName(slicePixelPosition);
    return this.baseURL + baseName + row + '_' + col + '_' + zoomLevel + '.' +
        this.fileExtension;
  };

  CATMAID.DefaultTileSource.prototype.getOverviewURL = function(stack, slicePixelPosition) {
    return this.baseURL + slicePixelPosition[0] + '/small.' + this.fileExtension;
  };


  /**
   * Creates the URL for a tile in a generic way.
   * To be used for instance for Volumina served datasources
   *
   * Source type: 2
   */
  CATMAID.RequestTileSource = function () {
    CATMAID.AbstractTileSource.apply(this, arguments);
  };

  CATMAID.RequestTileSource.prototype = Object.create(CATMAID.AbstractTileSource.prototype);

  CATMAID.RequestTileSource.prototype.getTileURL = function (
      project, stack, slicePixelPosition, col, row, zoomLevel) {
    return this.baseURL + '?' + $.param({
      x: col * this.tileWidth,
      y: row * this.tileHeight,
      width : this.tileWidth,
      height : this.tileHeight,
      row : 'y',
      col : 'x',
      scale : 1/(1 << zoomLevel), // Bitshift is safe because zoomLevel is integral.
      z : slicePixelPosition[0]
    });
  };


  /**
   * Get Tile from HDF5 through Django.
   *
   * Source type: 3
   */
  CATMAID.HDF5TileSource = function () {
    CATMAID.AbstractTileSource.apply(this, arguments);
  };

  CATMAID.HDF5TileSource.prototype = Object.create(CATMAID.AbstractTileSource.prototype);

  CATMAID.HDF5TileSource.prototype.getTileURL = function (
      project, stack, slicePixelPosition, col, row, zoomLevel) {
    return django_url + project.id + '/stack/' + stack.id + '/tile?' +
        $.param({
          x: col * this.tileWidth,
          y: row * this.tileHeight,
          width : this.tileWidth,
          height : this.tileHeight,
          row : 'y',
          col : 'x',
          scale : 1/(1 << zoomLevel), // Bitshift is safe because zoomLevel is integral.
          z: slicePixelPosition[0],
          file_extension: this.fileExtension,
          basename: this.baseURL,
          type:'all'
        });
  };


  /**
   * A tile source like the DefaultTileSource, but with a backslash
   * at the end.
   *
   * Source type: 4
   */
  CATMAID.BackslashTileSource = function () {
    CATMAID.AbstractTileSourceWithOverview.apply(this, arguments);
  };

  CATMAID.BackslashTileSource.prototype = Object.create(CATMAID.AbstractTileSourceWithOverview.prototype);

  CATMAID.BackslashTileSource.prototype.getTileURL = function (
      project, stack, slicePixelPosition, col, row, zoomLevel) {
    var baseName = CATMAID.getTileBaseName(slicePixelPosition);
    return this.baseURL + baseName + zoomLevel + '/' + row + '_' + col + '.' +
        this.fileExtension;
  };

  CATMAID.BackslashTileSource.prototype.getOverviewURL = function (stack, slicePixelPosition) {
    return this.baseURL + slicePixelPosition[0] + '/small.' + this.fileExtension;
  };


  /**
   * A tile source for large datasets where the scale and rows are encoded as
   * folders
   *
   * Source type: 5
   */
  CATMAID.LargeDataTileSource = function () {
    CATMAID.AbstractTileSourceWithOverview.apply(this, arguments);
  };

  CATMAID.LargeDataTileSource.prototype = Object.create(CATMAID.AbstractTileSourceWithOverview.prototype);

  CATMAID.LargeDataTileSource.prototype.getTileURL = function (
      project, stack, slicePixelPosition, col, row, zoomLevel) {
    var baseName = CATMAID.getTileBaseName(slicePixelPosition);
    return this.baseURL + zoomLevel + '/' + baseName + row + '/' +  col + '.' +
       this.fileExtension;
  };

  CATMAID.LargeDataTileSource.prototype.getOverviewURL = function (stack, slicePixelPosition) {
    return this.baseURL + 'small/' + slicePixelPosition[0] + '.' + this.fileExtension;
  };


  /**
   * Simple tile source type for DVID imageblk (uint8blk, rgba8blk) datatype
   * see https://github.com/janelia-flyem/dvid
   *
   * GET  <api URL>/node/<UUID>/<data name>/raw/<dims>/<size>/<offset>[/<format>][?throttle=true][?queryopts]
   * e.g. GET <api URL>/node/3f8c/grayscale/raw/0_1/512_256/0_0_100/jpg:80
   *
   * Source type: 6
   */
  CATMAID.DVIDImageblkTileSource = function () {
    CATMAID.AbstractTileSource.apply(this, arguments);

    this.transposeTiles.add(CATMAID.Stack.ORIENTATION_ZY);
  };

  CATMAID.DVIDImageblkTileSource.prototype = Object.create(CATMAID.AbstractTileSource.prototype);

  CATMAID.DVIDImageblkTileSource.prototype.getTileURL = function (
      project, stack, slicePixelPosition, col, row, zoomLevel) {
    if (stack.orientation === CATMAID.Stack.ORIENTATION_XY) {
      return this.baseURL + this.tileWidth + '_' + this.tileHeight + '/' + col * this.tileWidth + '_' +
          row * this.tileHeight + '_' + slicePixelPosition[0] + '/' + this.fileExtension;
    } else if (stack.orientation === CATMAID.Stack.ORIENTATION_XZ) {
      return baseURL + this.tileWidth + '_' + this.tileHeight + '/' + col * this.tileWidth + '_' +
          slicePixelPosition[0] + '_' + row * this.tileHeight + '/' + this.fileExtension;
    } else if (stack.orientation === CATMAID.Stack.ORIENTATION_ZY) {
      return baseURL + this.tileWidth + '_' + this.tileHeight + '/' + slicePixelPosition[0] + '_' +
          row * this.tileHeight + '_' + col * this.tileWidth + '/' + this.fileExtension;
    }
  };


  /**
   * Tile source for the Janelia tile render web-service
   *
   * https://github.com/saalfeldlab/render/tree/ws_phase_1
   *
   * Documentation on
   *
   * http://<render service host>/swagger-ui/#!/Bounding_Box_Image_APIs
   *
   * Source type: 7
   */
  CATMAID.RenderServTileSource = function () {
    CATMAID.AbstractTileSourceWithOverview.apply(this, arguments);

    this.maxTiles = null;
  };

  CATMAID.RenderServTileSource.prototype = Object.create(CATMAID.AbstractTileSourceWithOverview.prototype);

  CATMAID.RenderServTileSource.prototype.getTileURL = function (
      project, stack, slicePixelPosition, col, row, zoomLevel) {
    var baseName = CATMAID.getTileBaseName(slicePixelPosition);
    var url = this.baseURL + 'largeDataTileSource/' + this.tileWidth + '/' + this.tileHeight + '/' +
           zoomLevel + '/' + baseName + row + '/' +  col + '.' + this.fileExtension;

    var params = [];
    if (null !== this.maxTiles && undefined !== this.maxTiles) {
        params.push('maxTileSpecsToRender=' + this.maxTiles);
    }

    if (0 < params.length) {
      url += "?" + params.join("&");
    }

    return url;
  };

  CATMAID.RenderServTileSource.prototype.getOverviewURL = function (stack, slicePixelPosition) {
    return this.baseURL + 'largeDataTileSource/' + this.tileWidth + '/' + this.tileHeight + '/' +
           'small/' + slicePixelPosition[0] + '.' + this.fileExtension;
  };

  CATMAID.RenderServTileSource.prototype.getSettings = function () {
    return [
        {name: 'maxTiles', displayName: 'Maximum tiles', type: 'number', range: [0, 100000],
          value: this.maxTiles, help: 'Maximum number of image tiles to load for a section'}
      ];
  };


  /**
   * Simple tile source type for DVID imagetile datatype
   * see https://github.com/janelia-flyem/dvid
   *
   * GET  <api URL>/node/<UUID>/<data name>/tile/<dims>/<scaling>/<tile coord>[?noblanks=true]
   * e.g. GET <api URL>/node/3f8c/mymultiscale2d/tile/xy/0/10_10_20
   *
   * Source type: 8
   */
  CATMAID.DVIDImagetileTileSource = function () {
    CATMAID.AbstractTileSource.apply(this, arguments);

    this.transposeTiles.add(CATMAID.Stack.ORIENTATION_ZY);
  };

  CATMAID.DVIDImagetileTileSource.prototype = Object.create(CATMAID.AbstractTileSource.prototype);

  CATMAID.DVIDImagetileTileSource.prototype.getTileURL = function(
      project, stack, slicePixelPosition, col, row, zoomLevel) {
    if (stack.orientation === CATMAID.Stack.ORIENTATION_XY) {
      return this.baseURL + 'xy/' + zoomLevel + '/' + col + '_' + row + '_' + slicePixelPosition[0];
    } else if (stack.orientation === CATMAID.Stack.ORIENTATION_XZ) {
      return this.baseURL + 'xz/' + zoomLevel + '/' + col + '_' + slicePixelPosition[0] + '_' + row;
    } else if (stack.orientation === CATMAID.Stack.ORIENTATION_ZY) {
      return this.baseURL + 'yz/' + zoomLevel + '/' + slicePixelPosition[0] + '_' + row + '_' + col;
    }
  };


  /**
   * Serve images from Felix FlixServer.
   *
   * Source type: 9
   */
  CATMAID.FlixServerTileSource = function(baseURL, fileExtension, tileWidth, tileHeight) {
    CATMAID.AbstractTileSource.apply(this, arguments);

    this.color = null;
    this.minIntensity = null;
    this.maxIntensity = null;
    this.gamma = null;
    this.quality = null;
  };

  CATMAID.FlixServerTileSource.prototype = Object.create(CATMAID.AbstractTileSource.prototype);

  CATMAID.FlixServerTileSource.prototype.getTileURL = function (
      project, stack, slicePixelPosition, col, row, zoomLevel) {
    var baseName = CATMAID.getTileBaseName(slicePixelPosition);
    var url = this.baseURL + baseName + row + '_' + col + '_' + zoomLevel + '.' +
        this.fileExtension;

    var params = [];
    if (this.color) { params.push('color=' + this.color); }
    if (this.minIntensity) { params.push('min=' + this.minIntensity); }
    if (this.maxIntensity) { params.push('max=' + this.maxIntensity); }
    if (this.gamma) { params.push('gamma=' + this.gamma); }
    if (this.quality) { params.push('quality=' + this.quality); }

    if (0 < params.length) {
      url += "?" + params.join("&");
    }

    return url;
  };

  CATMAID.FlixServerTileSource.prototype.getOverviewURL = function (stack, slicePixelPosition) {
    return this.baseURL + slicePixelPosition[0] + '/small.' + this.fileExtension;
  };

  CATMAID.FlixServerTileSource.prototype.getSettings = function () {
    return [
        {name: 'color', displayName: 'Color', type: 'text', value: this.color,
          help: 'Use one or list of: red, green, blue, cyan, magenta, yellow, white. Use comma for multiple channels'},
        {name: 'minIntensity', displayName: 'Min Intensity', type: 'text', range: [0, 65535],
          value: this.maxIntensity, help: 'Minimum value of display range, e.g. 10.0, use comma for multiple channels'},
        {name: 'maxIntensity', displayName: 'Max Intensity', type: 'text', range: [0, 65535],
          value: this.maxIntensity, help: 'Maximum value of display range, e.g. 256.0, use comma for muliple channels'},
        {name: 'gamma', displayName: 'Gamma', type: 'text', range: [0, Number.MAX_VALUE],
          value: this.gamma, help: 'Exponent of non-linear mapping, e.g. 1.0, use comma for multiple channels'},
        {name: 'quality', displayName: 'Quality', type: 'number', range: [0, 100],
          value: this.quality, help: 'Image quality in range 0-100, use comma for multiple channels'}
      ];
  };


  /**
   * Tile source for Boss tiles.
   *
   * See https://docs.theboss.io/docs/image
   *
   * https://api.theboss.io/v1/tile/:collection/:experiment/:channel/:orientation/:tile_size/:resolution/:x_idx/:y_idx/:z_idx/:t_idx/
   *
   * Tile source: 10
   */
  CATMAID.BossTileSource = function () {
    CATMAID.AbstractTileSource.apply(this, arguments);

    if (this.tileWidth !== this.tileHeight)
      throw new CATMAID.ValueError('Tile width and height must be equal for Boss tile sources!');

    this.authToken = '';
    this.headers = {};
  };

  CATMAID.BossTileSource.prototype = Object.create(CATMAID.AbstractTileSource.prototype);

  CATMAID.BossTileSource.prototype.getTileURL = function (
      project, stack, slicePixelPosition, col, row, zoomLevel) {
    if (stack.orientation === CATMAID.Stack.ORIENTATION_XY) {
      return this.baseURL + 'xy/' + this.tileWidth + '/' + zoomLevel + '/' + col + '/' + row + '/' + slicePixelPosition[0];
    } else if (stack.orientation === CATMAID.Stack.ORIENTATION_XZ) {
      return this.baseURL + 'xz/' + this.tileWidth + '/' + zoomLevel + '/' + col + '/' + slicePixelPosition[0] + '/' + row ;
    } else if (stack.orientation === CATMAID.Stack.ORIENTATION_ZY) {
      return this.baseURL + 'yz/' + this.tileWidth + '/' + zoomLevel + '/' + col + '/' + row + '/' + slicePixelPosition[0];
    }
  };

  CATMAID.BossTileSource.prototype.getSettings = function () {
    return [
        {name: 'authToken', displayName: 'Boss auth token', type: 'text', value: this.authToken,
          help: 'TODO'},
      ];
  };

  CATMAID.BossTileSource.prototype.setSetting = function () {
    CATMAID.AbstractTileSource.prototype.setSetting.apply(this, arguments);
    this._buildRequestHeaders();
  };

  CATMAID.BossTileSource.prototype._buildRequestHeaders = function () {
    this.headers = {'Authorization': 'Token ' + this.authToken};
  };

  CATMAID.BossTileSource.prototype.getRequestHeaders = function () {
    return this.headers;
  };


  /**
   * This is an overview layer that doesn't display anything.
   */
  CATMAID.DummyOverviewLayer = function() {
    this.redraw = function() { };
    this.unregister = function() { };
  };

  /**
   * An overview layer that doesn't attempt to get an image, but only shows a
   * blank area, optionally with a grid on top. This can be used as fallback if
   * no overview image can be loaded.
   */
  CATMAID.ArtificialOverviewLayer = function(layer) {
    this.backgroundColor = "#000";
    this.nGridLines = 5;
    this.gridStyle = "#777";

    this.layer = layer;
    this.canvas = document.createElement('canvas');
    this.canvas.classList.add('smallMapMap');

    var maxWidth = 192;
    var maxHeight = 192;

    // Size canvas to be proportional to image stack data
    var stack = layer.getStack();
    if (stack.dimension.x > stack.dimension.y) {
      this.canvas.width = maxWidth;
      this.canvas.height = (maxWidth / stack.dimension.x) * stack.dimension.y;
    } else {
      this.canvas.width = (maxHeight / stack.dimension.y) * stack.dimension.x;
      this.canvas.height = maxHeight;
    }

    var stackViewer = layer.getStackViewer();
    stackViewer.overview.getView().appendChild(this.canvas);
    stackViewer.overview.addLayer('tilelayer', this);
  };

  CATMAID.ArtificialOverviewLayer.prototype.redraw = function() {
    // Fill context with background color and optionally draw a grid.
    if (this.canvas) {
      var ctx = this.canvas.getContext("2d");
      ctx.fillStyle = this.backgroundColor;
      ctx.fillRect(0,0, this.canvas.width, this.canvas.height);

      if (this.nGridLines > 0) {
        var xSpacing = this.canvas.width / (this.nGridLines + 1);
        var ySpacing = this.canvas.height / (this.nGridLines + 1);
        ctx.strokeStyle = this.gridStyle;
        ctx.lineWidth = 1.0;
        for (var i=1; i<=this.nGridLines; ++i) {
          // Draw vertical line. According to MDN positioning lines inbetween
          // exact pixel positions allows for more crips drawing:
          // https://developer.mozilla.org/en-US/docs/Web/API/Canvas_API/Tutorial/Applying_styles_and_colors
          var x = Math.round(i * xSpacing) + 0.5;
          ctx.moveTo(x, 0);
          ctx.lineTo(x, this.canvas.height);
          ctx.stroke();
          // Draw horizontal line
          var y = Math.round(i * ySpacing) + 0.5;
          ctx.moveTo(0, y);
          ctx.lineTo(this.canvas.width, y);
          ctx.stroke();
        }
      }
    }
  };

  CATMAID.ArtificialOverviewLayer.prototype.unregister = function() {
    if (this.canvas && this.canvas.parentNode) {
      this.canvas.parentNode.removeChild(this.canvas);
    }
  };

  /**
   * This is an overview layer that displays a small overview map.
   */
  CATMAID.GenericOverviewLayer = function(layer, baseURL, fileExtension,
                                          getOverviewURL) {
    // Initialize prototype
    CATMAID.ArtificialOverviewLayer.call(this, layer);

    this.redraw = function() {
      var stack = layer.getStack();
      var stackViewer = layer.getStackViewer();
      var slicePixelPosition = [stackViewer.scaledPositionInStack(stack).z];
      img.src = getOverviewURL(stack, slicePixelPosition);
    };

    var img = document.createElement( 'img' );
    img.className = 'smallMapMap';

    // If images can't be loaded, fall-back to the artificial overview layer
    img.onerror = (function() {
      CATMAID.ArtificialOverviewLayer.prototype.redraw.call(this);
    }).bind(this);

    // After the image has been loaded, draw it to the overview canvas
    img.onload = (function() {
      if (this.canvas) {
        var ctx = this.canvas.getContext("2d");
        ctx.width = img.width;
        ctx.height = img.height;
        ctx.drawImage(img, 0, 0);
      }
    }).bind(this);

    this.redraw(); // sets the img URL
  };

  CATMAID.GenericOverviewLayer.prototype = Object.create(CATMAID.ArtificialOverviewLayer.prototype);

})(CATMAID);
