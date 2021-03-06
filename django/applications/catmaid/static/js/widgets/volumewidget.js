/* -*- mode: espresso; espresso-indent-level: 2; indent-tabs-mode: nil -*- */
/* vim: set softtabstop=2 shiftwidth=2 tabstop=2 expandtab: */

(function(CATMAID) {

  "use strict";

  /**
   * Stores information about widget mode switches.
   */
  var Context = function(onExit) {
    this.onExit = onExit;
  };

  /**
   * Manage spatial volumes with this widget.
   */
  var VolumeManagerWidget = function(options) {
    options = options || {};

    // Stores information about current widget mode
    this.currentContext = null;
    // Access to the displayed DataTable
    this.datatable = null;
    this.entriesPerPage = options.entriesPerPage || 25;
    // Default volume type
    this.defaultVolumeType = options.defaultVolumeType || "box";
  };

  VolumeManagerWidget.prototype.getName = function() {
    return "Volume Manager";
  };

  VolumeManagerWidget.prototype.getWidgetConfiguration = function() {
    return {
      controlsID: 'volume_manager_controls',

      /**
       * Create controls to refresh volumes.
       */
      createControls: function(controls) {
        var refresh = document.createElement('button');
        refresh.appendChild(document.createTextNode('Refresh'));
        refresh.onclick = this.redraw.bind(this);
        controls.appendChild(refresh);

        var add = document.createElement('button');
        add.appendChild(document.createTextNode('Add new volume'));
        add.onclick = this.addVolume.bind(this);
        controls.appendChild(add);

        var hiddenFileButton = CATMAID.DOM.createFileButton(false, false,
            (function(event) {
              var files = event.target.files;
              if (0 === files.length) {
                CATMAID.error("Choose at least one file!");
              } else {
                filesforEach(this.addVolumeFromFile);
              }
            }).bind(this));
        controls.appendChild(hiddenFileButton);

        var openFile = document.createElement('button');
        openFile.appendChild(document.createTextNode('Add from file'));
        openFile.onclick = hiddenFileButton.click.bind(hiddenFileButton);
        controls.appendChild(openFile);
      },

      contentID: 'volume_manger_content',

      /**
       * Create content, which is basically a DataTable instance, getting Data
       * from the back-end.
       */
      createContent: function(container) {
        var table = document.createElement('table');
        table.style.width = "100%";
        var header = table.createTHead();
        var hrow = header.insertRow(0);
        var columns = ['Name', 'Comment', 'User', 'Creation time',
            'Editor', 'Edition time', 'Action'];
        columns.forEach(function(c) {
          hrow.insertCell().appendChild(document.createTextNode(c));
        });

        var tableContainer = document.createElement('div');
        tableContainer.setAttribute('class', 'volume-list');
        tableContainer.appendChild(table);
        container.appendChild(tableContainer);
        this.datatable = $(table).DataTable({
          lengthMenu: [CATMAID.pageLengthOptions, CATMAID.pageLengthLabels],
          ajax: {
            url: CATMAID.makeURL(project.id +  "/volumes/"),
            dataSrc: ""
          },
          columns: [
            {data: "name"},
            {data: "comment"},
            {
              data: "user",
              render: function(data, type, row, meta) {
                return CATMAID.User.safe_get(data).login;
              }
            },
            {data: "creation_time"},
            {
              data: "editor",
              render: function(data, type, row, meta) {
                return CATMAID.User.safe_get(data).login;
              }
            },
            {data: "edition_time"},
            {
              data: null,
              orderable: false,
              defaultContent: '<a href="#">remove</a>'
            }
          ],
        });

        // Remove volume if 'remove' was clicked
        $(table).on('click', 'a', function() {
          var tr = $(this).closest("tr");
          var volume = self.datatable.row(tr).data();

          var confirmDialog = new CATMAID.OptionsDialog("Remove volume", {
            "Yes": function() {
              CATMAID.fetch(project.id + '/volumes/' + volume.id + '/', 'DELETE')
                .then(function(json) {
                  CATMAID.msg('Success', 'Volume ' + json.volume_id + ' removed');
                  self.redraw();
                })
                .catch(CATMAID.handleError);
            },
            "No": CATMAID.noop
          });
          confirmDialog.appendMessage("Are you sure you want to delete volume "
              + volume.id + " (" + volume.name + ")?");
          confirmDialog.show(500,'auto');

          // Prevent other events from dealing with this click
          return false;
        });

        // Display a volume if clicked
        var self = this;
        $(table).on('click', 'td', function() {
          var tr = $(this).closest("tr");
          var volume = self.datatable.row(tr).data();
          self.loadVolume(volume.id)
            .then(self.editVolume.bind(self))
            .catch(CATMAID.handleError);
        });
      }
    };
  };

  /**
   * Update volume listing.
   */
  VolumeManagerWidget.prototype.redraw = function(container) {
    if (!this.datatable) {
      return;
    }
    // Get list of available volumes
    this.datatable.ajax.reload();
  };

  /**
   * Return a promise for a volume from the back-end.
   */
  VolumeManagerWidget.prototype.loadVolume = function(volumeId) {
    return CATMAID.fetch(project.id + '/volumes/' + volumeId + '/', 'GET')
      .then(function(json) {
        // Expect box for now
        var type = 'box';
        // Try to create volume instance
        var bbox = json.bbox;
        var volumeType = volumeTypes[type];
        return volumeType.createVolume({
          minX: bbox.min.x,
          minY: bbox.min.y,
          minZ: bbox.min.z,
          maxX: bbox.max.x,
          maxY: bbox.max.y,
          maxZ: bbox.max.z,
          title: json.name,
          comment: json.comment,
          id: json.id
        });
      });
  };

  /**
   * Request volume details, show edit controls and display a bounding box
   * overlay. If no volume ID is given, a new volume is assumed.
   */
  VolumeManagerWidget.prototype.editVolume = function(volume) {
    var self = this;
    var createNewVolume = !volume;

    if (this.currentContext) {
      CATMAID.tools.callIfFn(this.currentContext.onExit);
    }

    var $content = $('#volume_manger_content');
    // Hide table
    $("div.volume-list", $content).hide();

    // Display inline editor for properties of new volume
    var $addContent = $(document.createElement('div'));
    $addContent.addClass('settings-container volume-properties');

    var vid = this.datatable ? this.datatable.length + 1 : 1;
    var volumeType, volumeHelper;
    if (volume) {
      volumeType = getVolumeType(volume);
      volumeHelper = volumeTypes[volumeType];
    } else {
      volumeType = this.defaultVolumeType;
      volumeHelper = volumeTypes[volumeType];
      if (!volumeType) {
        throw CATMAID.ValueError("Couldn't find volume type: " +
            this.defaultVolumeType);
      }
      volume = volumeHelper.createVolume({});
    }

    var title = function(e) { volume.title = this.value; };
    var comment = function(e) { volume.comment = this.value; };
    if (createNewVolume) {
      var typeSelect = CATMAID.DOM.createSelectSetting("Type",
          {
            "Box": "box",
            "Convex Hull": "convexhull",
            "Alpha shape": "alphashape"
          },
          "The geometry type of this volume.", undefined, volumeType);
      $addContent.append(typeSelect);
      $('select', typeSelect).on('change', function() {
        $("div.volume-properties", $content).remove();
        var volumeHelper = volumeTypes[this.value];
        self.editVolume(volumeHelper.createVolume({}));
      });
    }

    $addContent.append(CATMAID.DOM.createInputSetting("Name", volume.title,
        "This name will be used whereever CATMAID refers to this volume in " +
        "its user interface.", title));

    $addContent.append(CATMAID.DOM.createInputSetting("Comment", volume.comment,
        "Additional information regarding this volume.", comment));

    var volumeSettings = volumeHelper.createSettings(volume);
    if (!createNewVolume) {
      $('input', volumeSettings).attr('disabled', 'disabled');
    }
    $addContent.append(volumeSettings);

    // Create volume update and close handlers (used for preview)
    var handlers = volumeHelper.createHandlers(volume);
    var onUpdate = handlers[0];
    var closeVolumeEdit = handlers[1];

    var onClose = function(save, onSuccess, onCancel) {
      if (CATMAID.tools.isFn(closeVolumeEdit)) {
        var onSuccessWrapper = function() {
          volume.off(volume.EVENT_PROPERTY_CHANGED, volumeChanged);
          CATMAID.tools.callIfFn(onSuccess);
        };
        closeVolumeEdit(save, onSuccessWrapper, onCancel);
      }
    };
    $addContent.append($('<div class="clear" />'));
    $addContent.append($('<div />')
        .append($('<button>Cancel</Cancel>')
          .on('click', function(e) {
            onClose(false, function() {
              // Show table
              $("div.volume-list", $content).show();
              $("div.volume-properties", $content).remove();
            });
          }))
        .append($('<button>Save</Cancel>')
          .on('click', function(e) {
            $.blockUI({message: '<img src="' + CATMAID.staticURL +
                'images/busy.gif" /> <span>Please wait, creating volume</span>'});
            function save() {
              try {
                onClose(true, function() {
                  volume.save()
                    .then(function(result) {
                      // Show table, remove volume settings
                      $("div.volume-list", $content).show();
                      $("div.volume-properties", $content).remove();
                    }).catch(CATMAID.handleError)
                    .then(function() {
                      $.unblockUI();
                      self.redraw();
                    });
                }, function() {
                  CATMAID.warn("Couldn't save volume");
                  $.unblockUI();
                });
              } catch(e) {
                $.unblockUI();
                CATMAID.error("Couldn't create volume: " + e);
              }
            }
            setTimeout(save, 100);
          })));

    $content.append($addContent);

    function volumeChanged(field, newValue, oldValue) {
      if (CATMAID.tools.isFn(onUpdate)) {
        onUpdate(field, newValue, oldValue);
      }
    }

    volume.on(volume.EVENT_PROPERTY_CHANGED, volumeChanged);
    this.currentContext = new Context(onClose);
  };

  /**
   * Load volumes from a passed in file path. The file format is expected to be
   * JSON. A list of objects with a type and a properties field.  For instance:
   *
   * [{
   *   "type": "box",
   *   "properties": {
   *     "minX": 0,
   *     "minY": 0,
   *     "minZ": 0,
   *     "maxX": 1,
   *     "maxY": 1,
   *     "maxZ": 1,
   *   }
   * }]
   *
   * @param {String} files The file to load
   */
  VolumeManagerWidget.prototype.addVolumeFromFile = function(path) {
      var self = this;
      var reader = new FileReader();
      reader.onload = function(e) {
          var volumes = JSON.parse(e.target.result);
          // Try to load volumes and record invalid ones
          var invalidVolumes = volumes.filter(function(v) {
            var volumeType = volumeTypes[v.type];
            var properties = v.properties;
            if (volumeType && properties) {
              volumeType.createVolume(properties);
            } else {
              // Return true for invalid volume types
              return !volumeType;
            }
          });
      };
      reader.readAsText(files[0]);
  };

  /**
   * Add a new  volume. Edit it its properties directly in the widget.
   */
  VolumeManagerWidget.prototype.addVolume = function() {
    this.editVolume(null);
  };

  var getVolumeType = function(volume) {
    if (volume instanceof CATMAID.AlphaShapeVolume) {
      return "alphashape";
    } else if (volume instanceof CATMAID.ConvexHullVolume) {
      return "convexhull";
    } else if (volume instanceof CATMAID.BoxVolume) {
      return "box";
    } else {
      throw new CATMAID.ValueError("Unknown volume type");
    }
  };

  /**
   * Either convex hull or alpha-shape, which are almost identical. The
   * alpha-shape has an extra parameter, the alpha.
   */
  var makeVolume = function(name, theclass, withAlpha) {
    return {
      name: name,
      createSettings: function(volume) {
        // TODO source is never used?
        var source = function(e) {
          var source = CATMAID.skeletonListSources.getSource(this.value);
          volume.set("neuronSource", source);
        };

        var ruleType = function(e) { };
        var $settings = $('<div />');
        var $content = CATMAID.DOM.addSettingsContainer($settings,
            name + " rule settings", false);

        // Option to control preview
        var preview = CATMAID.DOM.createCheckboxSetting(
            "Preview in 3D viewer", volume.preview, "If checked the first " +
            "available 3D viewer will be used to preview the meshes before saving.",
            function(e) { volume.set("preview", this.checked); });
        $content.append(preview);

        // Inject color picker into preview checkbox label
        var $previewColor = CATMAID.DOM.createInputSetting(
            "Preview color", volume.previewColor,
            "Set the color of the volume 3D preview.");
        $content.append($previewColor);
        CATMAID.ColorPicker.enable($('input', $previewColor), {
          initialColor: volume.previewColor,
          initialAlpha: volume.previewOpacity,
          onColorChange: function(color, alpha, colorChanged, alphaChanged) {
            if (colorChanged) {
              var hexColor = CATMAID.tools.rgbToHex(
                Math.round(255 * color.r),
                Math.round(255 * color.g),
                Math.round(255 * color.b));
              volume.set('previewColor', hexColor);
            }
            if (alphaChanged) {
              volume.set('previewOpacity', alpha);
            }
          }
        });

        // The skeleton source
        var availableSources = CATMAID.skeletonListSources.getSourceNames();
        var sourceOptions = availableSources.reduce(function(o, name) {
          o[name] = name;
          return o;
        }, {});
        // Set a default source, if there is no source set yet
        if (!volume.neuronSourceName && availableSources.length > 0) {
          volume.set("neuronSourceName", availableSources[0]);
        }
        $content.append(CATMAID.DOM.createCheckboxSetting("Respect node radius",
            volume.respectRadius, "If checked, every valid node with a radius will " +
            "trigger the creation of 12 additional equally distibuted points around it, " +
            "having a distance of the node's radius.",
            function(e) { volume.set("respectRadius", this.checked); }));
        $content.append(CATMAID.DOM.createSelectSetting("Skeleton source",
            sourceOptions, "The selection to draw points from", function(e) {
              volume.set("neuronSourceName", this.value);
            }, volume.neuronSourceName));

        if (withAlpha) {
          var defaultAlphaStep = 10.0;
          var alphaInputWrapper = CATMAID.DOM.createNumericInputSetting("Alpha (nm)",
              volume.alpha, defaultAlphaStep,
              "Only triangles with a circumsphere radius less than alpha will be used",
              function(e) {
                volume.set("alpha", Number(this.value));
              });
          $content.append(alphaInputWrapper);

          // Also update on mouse clicks and mouse wheel
          var alphaInput = alphaInputWrapper.find('input');
          alphaInput.on('mouseup mousewheel', function() {
            volume.set("alpha", Number(this.value));
          });

          $content.append(CATMAID.DOM.createNumericInputSetting("",
              defaultAlphaStep, 10.0, "Set the alpha change step for the numeric input above",
              function(e) {
                alphaInput.prop('step', Number(this.value));
              }));

          $content.append(CATMAID.DOM.createCheckboxSetting("Filter triangles",
              volume.filterTriangles, "If checked, the alpha filter will be " +
              "applied to individual triangles of the mesh. Otherwise, alpha " +
              "is used to filter the tetrahedra of the 3D triangulation.",
              function(e) { volume.set("filterTriangles", this.checked); }));
        }

        // Get available filter strategeis
        var nodeFilters = Object.keys(CATMAID.NodeFilterStrategy).reduce(function(o, p) {
          o[CATMAID.NodeFilterStrategy[p].name] = p;
          return o;
        }, {});
        CATMAID.DOM.appendNewNodeFilterControls(nodeFilters, $content, function(rule, strategt) {
          volume.rules.push(rule);
          // To trigger events, override with itself
          volume.set("rules", volume.rules, true);
          // Trigger table update
          datatable.rows().invalidate();
          datatable.ajax.reload();
        });

        // Get available rules
        var table = document.createElement('table');
        table.style.width = "100%";
        var header = table.createTHead();
        var hrow = header.insertRow(0);
        var columns = ['On', 'Name', 'Merge mode', 'Options', 'Is skeleton', 'Has name'];
        columns.forEach(function(c) {
          hrow.insertCell().appendChild(document.createTextNode(c));
        });

        var self = this;

        var tableContainer = document.createElement('div');
        tableContainer.appendChild(table);
        $content.append(tableContainer);
        var datatable = $(table).DataTable({
          dom: "tp",
          ajax: function(data, callback, settings) {
            var rules = volume.rules;
            callback({
              draw: data.draw,
              recordsTotal: rules.length,
              recordsFiltered: rules.length,
              data: rules
            });
          },
          order: [],
          columns: [
            {
              orderable: false,
              render: function(data, type, row, meta) {
                var checked = !row.skip;
                return '<input type="checkbox" ' + (checked ? 'checked /> ' : '/>');
              }
            },
            {
              orderable: false,
              data: "strategy.name"
            },
            {
              orderable: false,
              render: function(data, type, row, meta) {
                return row.mergeMode === CATMAID.UNION ? "Union" :
                    (row.mergeMode === CATMAID.INTERSECTION ? "Intersection" : row.mergeMode);
              }
            },
            {
              orderable: false,
              render: function(data, type, row, meta) {
                return row.options ? JSON.stringify(row.options) : "-";
              }
            },
            {
              orderable: false,
              render: function(data, type, row, meta) {
                return row.validOnlyForSkid ? row.validOnlyForSkid : "-";
              }
            },
            {
              orderable: false,
              render: function(data, type, row, meta) {
                return row.validOnlyForName ? row.validOnlyForName : "-";
              }
            }
          ],
          language: {
            emptyTable: "No filters added yet (defaults to take all nodes)"
          }
        });

        // Updated skipping of rules
        $(table).on('change', 'td', function(e) {
          var tr = $(this).closest("tr");
          var rule = datatable.row(tr).data();
          rule.skip = !e.target.checked;
          // Trigger events
          volume.set("rules", volume.rules, true);
        });

        if (volume.preview) {
          volume.updateTriangleMesh();
        }

        return $settings;
      },
      createVolume: function(options) {
        var volume = new CATMAID[theclass](options);
        volume.init();
        return volume;
      },
      /**
       * Create an array of handlers: [onVolumeUpdate, onVolumeClose]
       */
      createHandlers: function(volume) {
        // Give some feedback in case of problems
        var checkGeneratedMesh = function(volume, mesh) {
          var meshNeedsUpdate = false;
          if (!mesh || 0 === mesh.length) {
            CATMAID.warn("Neither points nor mesh could be generated");
            meshNeedsUpdate = true;
          } else if (!mesh[0] || 0 === mesh[0].length) {
            CATMAID.warn("Couldn't find points for volume generation");
            meshNeedsUpdate = true;
          } else if (!mesh[1] || 0 === mesh[1].length) {
            CATMAID.warn("Couldn't generate volume from degenerative points");
            meshNeedsUpdate = true;
          }
          volume.meshNeedsSync = meshNeedsUpdate;
          return !meshNeedsUpdate;
        };
        var onUpdate = function(field, newValue, oldValue) {
          // Recalculate mesh if preview was just enabled
          if (volume.preview && "preview" === field) {
            volume.meshNeedsSync = true;
          }
          // Re-create mesh if the updated field is no 'basic' property to avoid
          // unnecessary re-calculation.
          if (volume.preview && volume.meshNeedsSync) {
            $.blockUI({message: '<img src="' + CATMAID.staticURL +
                'images/busy.gif" /> <span>Please wait, creating volume</span>'});
            var onSuccess = function(volume, mesh) {
              checkGeneratedMesh(volume, mesh);
              $.unblockUI();
            };
            var updateMesh = volume.updateTriangleMesh.bind(volume, onSuccess,
                $.unblockUI.bind($));
            setTimeout(updateMesh, 100);
          } else if (!volume.preview && "preview" === field) {
            // Preview just got disabled
            volume.clearPreviewData();
          }
        };
        var onClose = function(save, onSuccess, onCancel) {
          if (save) {
            var onSuccessWrapper = function(volume, mesh) {
              if (checkGeneratedMesh(volume, mesh)) {
                CATMAID.tools.callIfFn(onSuccess);
              } else {
                CATMAID.tools.callIfFn(onCancel);
              }
              // Remove previewed meshes from 3D viewer
              volume.clearPreviewData();
            };
            if (volume.meshNeedsSync) {
              volume.updateTriangleMesh(onSuccessWrapper);
            } else {
              onSuccessWrapper(volume, volume.mesh);
            }
          } else {
            // Remove previewed meshes from 3D viewer
            volume.clearPreviewData();
            CATMAID.tools.callIfFn(onSuccess);
          }
        };
        return [onUpdate, onClose];
      },
    };
  };

  var volumeTypes = {
    "box": {
      name: "Box",
      createSettings: function(volume) {
        var minX = function(e) { volume.set("minX", Number(this.value)); };
        var minY = function(e) { volume.set("minY", Number(this.value)); };
        var minZ = function(e) { volume.set("minZ", Number(this.value)); };
        var maxX = function(e) { volume.set("maxX", Number(this.value)); };
        var maxY = function(e) { volume.set("maxY", Number(this.value)); };
        var maxZ = function(e) { volume.set("maxZ", Number(this.value)); };
        var $settings = $('<div />');
        var $content = CATMAID.DOM.addSettingsContainer($settings,
            "Box settings", false);
        $content.append(CATMAID.DOM.createInputSetting("Min X", volume.minX,
              "X coordinate of the boxes minimum corner.", minX));
        $content.append(CATMAID.DOM.createInputSetting("Min Y", volume.minY,
              "Y coordinate of the boxes minimum corner.", minY));
        $content.append(CATMAID.DOM.createInputSetting("Min Z", volume.minZ,
              "Z coordinate of the boxes minimum corner.", minZ));
        $content.append(CATMAID.DOM.createInputSetting("Max X", volume.maxX,
              "X coordinate of the boxes maximum corner.", maxX));
        $content.append(CATMAID.DOM.createInputSetting("Max Y", volume.maxY,
              "Y coordinate of the boxes maximum corner.", maxY));
        $content.append(CATMAID.DOM.createInputSetting("Max Z", volume.maxZ,
              "Z coordinate of the boxes maximum corner.", maxZ));

        return $settings;
      },
      createVolume: function(options) {
        return new CATMAID.BoxVolume(options);
      },
      /**
       * Create an array of handlers: [onVolumeUpdate, onVolumeClose]
       */
      createHandlers: function(volume) {
        var handlers = [null, null];
        if (project.focusedStackViewer) {
          var stack = project.focusedStackViewer;
          // TODO: Use a proper layer for this and make this work wirh regular
          // ortho stacks.
          var boxTool = new CATMAID.BoxSelectionTool();
          boxTool.destroy();
          boxTool.register(stack);
          boxTool.createCropBoxByWorld(
              volume.minX, volume.minY, Math.abs(volume.maxX - volume.minX),
              Math.abs(volume.maxY - volume.minY), 0);

          var onUpdate = function(field, newValue, oldValue) {
            boxTool.cropBox.top = volume.minY;
            boxTool.cropBox.bottom = volume.maxY;
            boxTool.cropBox.left = volume.minX;
            boxTool.cropBox.right = volume.maxX;
            boxTool.updateCropBox();
          };

          var onCloseVolumeEdit = function(save, onSuccess, onCancel) {
            boxTool.destroy();
            onSuccess();
          };

          return [onUpdate, onCloseVolumeEdit];
        } else {
          return [null, null];
        }
      }
    },

    /**
     * Convex hulls can be created around a set of points. Points are provided
     * by point sources which then can be restricted further.
     */
    "convexhull": makeVolume("Convex hull", "ConvexHullVolume"),

    /**
     * Alpha-shapes can be created around a set of points. Points are provided
     * by point sources which are then restricted further.
     */
     "alphashape": makeVolume("Alpha shape", "AlphaShapeVolume", true)
  };

  // A key that references this widget in CATMAID
  var widgetKey = "volume-manager-widget";

  // Register widget with CATMAID
  CATMAID.registerWidget({
    name: "Volume Manager",
    description: "List and edit volumes and create new ones",
    key: widgetKey,
    creator: VolumeManagerWidget
  });

  // Add an action to the tracing tool that will open this widget
  CATMAID.TracingTool.actions.push(new CATMAID.Action({
    helpText: "Volume Manger: Create and manage volumes based on skeletons and spatial properties",
    buttonID: "data_button_volume_manager",
    buttonName: 'volume_manager',
    iconURL: CATMAID.makeStaticURL('images/volume-manager.svg'),
    run: function (e) {
        WindowMaker.show(widgetKey);
        return true;
    }
  }));

})(CATMAID);
