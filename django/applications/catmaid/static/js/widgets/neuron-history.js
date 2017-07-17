/* -*- mode: espresso; espresso-indent-level: 2; indent-tabs-mode: nil -*- */
/* vim: set softtabstop=2 shiftwidth=2 tabstop=2 expandtab: */

(function(CATMAID) {

  "use strict";

  /**
   * Show reconstruction progress of individual neuron over time, making use of
   * history information if available.
   */
  var NeuronHistoryWidget = function() {
    this.widgetID = this.registerInstance();
    var refresh = this.refresh.bind(this);
    this.skeletonSource = new CATMAID.BasicSkeletonSource(this.getName(), {
      handleAddedModels: refresh,
      handleChangedModels: refresh,
      handleRemovedModels: refresh
    });
    // The maximum allowed inacitivty time (minutes)
    this.maxInactivityTime = 3;
    // Will store a datatable instance
    this.table = null;

    CATMAID.skeletonListSources.updateGUI();
  };

  NeuronHistoryWidget.prototype = new InstanceRegistry();
  NeuronHistoryWidget.prototype.constructor = NeuronHistoryWidget;

  NeuronHistoryWidget.prototype.getName = function() {
    return "Neuron History " + this.widgetID;
  };

  NeuronHistoryWidget.prototype.destroy = function() {
    this.unregisterInstance();
    this.skeletonSource.destroy();
  };

  NeuronHistoryWidget.prototype.getWidgetConfiguration = function() {
    return {
      createControls: function(controls) {
        var self = this;
        var sourceSelect = CATMAID.skeletonListSources.createSelect(this.skeletonSource);
        controls.appendChild(sourceSelect);

        var add = document.createElement('input');
        add.setAttribute("type", "button");
        add.setAttribute("value", "Append");
        add.onclick = this.skeletonSource.loadSource.bind(this.skeletonSource);
        controls.appendChild(add);

        var clear = document.createElement('input');
        clear.setAttribute("type", "button");
        clear.setAttribute("value", "Clear");
        clear.onclick = this.clear.bind(this);
        controls.appendChild(clear);

        var refresh = document.createElement('input');
        refresh.setAttribute("type", "button");
        refresh.setAttribute("value", "Refresh");
        refresh.onclick = this.refresh.bind(this);
        controls.appendChild(refresh);
      },
      createContent: function(content) {
        var self = this;
        var container = document.createElement('div');
        content.appendChild(container);

        var message = document.createElement('p');
        message.appendChild(document.createTextNode("This widget shows " +
          "information on the reconstruction progress of individual neurons " +
          "over time. Some information (splits and merges) is only available " +
          "if history tracking was enabled during reconstruction."));

        var table = document.createElement('table');
        table.style.width = "100%";
        content.appendChild(table);

        this.table = $(table).DataTable({
          dom: "lrphtip",
          paging: true,
          order: [],
          lengthMenu: [CATMAID.pageLengthOptions, CATMAID.pageLengthLabels],
          ajax: function(data, callback, settings) {
            // Compile skeleton statistics and call datatables with results.
            self.getNeuronStatistics()
              .then(function(data) {
                callback({
                  draw: data.draw,
                  recordsTotal: data.length,
                  recordsFiltered: data.length,
                  data: data
                });
              })
              .catch(CATMAID.handleError);
          },
          "headerCallback": function( nHead, aData, iStart, iEnd, aiDisplay ) {
            var datatable = $(table).DataTable();
            datatable.columns().iterator('column', function ( settings, column) {
              if (settings.aoColumns[ column ].help!== undefined) {
                $(datatable.column(column).header()).attr('title', settings.aoColumns[ column ].help);
              }
            });
          },
          columns: [
            {className: "cm-center", title: "Skeleton ID", data: "skeletonId"},
            {className: "cm-center", title: "Tracing time", data: "tracingTime"},
            {className: "cm-center", title: "Review time", data: "reviewTime"},
            {title: "Cable before review", data: "cableBeforeReview",
                help: "Unsmoothed cable length before first review, measured in nanometers."},
            {title: "Cable after review", data: "cableAfterReview",
                help: "Unsmoothed cable length after last review, measured in nanometers."},
            {title: "Connectors before review", data: "connBeforeReview",
                help: "Number of synaptic connections to partners before first review."},
            {title: "Connectors after review", data: "connAfterReview",
                help: "Number of synaptic connections to partners after last review."},
          ]
        });
      },
      helpText: [
        '<p>This widget shows statistics on reconstruction and review of ',
        'neurons over time. To do this, it groups at all events that are either ',
        'part of the reconstruction or the review process of the input neurons. Events ',
        'that are seen as reconstruction events are <em>Node creation/update/',
        'deletion, connector creation/update/deletion as well as tag creation/',
        'update/deletion</em>. </em>Reconstruction events</em> are only represented by ',
        'themselves. Both lists of events are then used to create lists of so ',
        'called active bouts, a sorted series of events where the time ',
        'between two successive events isn\'t larger than a defined ',
        '<em>maximum inactivity time</em>. The default length of this time is ',
        '3 minutes. Based on these lists of bouts, the widget calculates the ',
        'following for each input skeleton:',
        '<dl>',
        '<dt>Tracing time</dt><dd>The sum of all active tracing bouts by all users.</dt>',
        '<dt>Review time</dt><dd>The sum of all active review bouts by all users.</dt>',
        '<dt>Cable before review</dt><dd>Cable length before first review event.</dt>',
        '<dt>Cable after review</dt><dd>Cable length after last review event.</dt>',
        '<dt>Connectors before review</dt><dd>The number of connectors before first review event.</dt>',
        '<dt>Connectors after review</dt><dd>The number of connectors after last review event</dt>',
        '</dl></p>',
        '<p>All values are calulate per skeleton and depending on the skeleton\'s ',
        'size, it is possivle this takes a few minutes.</p>',
      ].join('\n')
    };
  };

  function compareCompactTreenodes(a, b) {
    return a[8] < a[9];
  }

  function compareCompactConnectors(a, b) {
    return a[6] < a[6];
  }

  function cableLength(arbor, positions) {
    var children = arbor.childrenArray(),
        sum = 0;
    for (var i=0; i<children.length; ++i) {
      var node = children[i];
      var parentPos = positions[arbor.edges[node]];
      if (!parentPos) {
        parentPos = positions[node];
      }
      sum += positions[node].distanceTo(parentPos);
    }
    return sum;
  }

  /**
   * Return a promise that resolves with a list of objects, where each
   * represents a set of statistics for a neuron. These statistics are:
   *
   * Tracing time:  sum of all active bouts of create/edit events by all users
   * Review time:   sum of all active bouts of review events by all users
   * Cable before:  cable length before first review event
   * Cable after:   cable length after last review event
   * Conn. before:  number of connectors before first review event
   * Conn. after:   number of connectors after last review event
   * Review splits: Number of splits between first and last review event
   * Review merges: Number of merges between first and last review event
   *
   * @returns Promise instance resolving in above statistics for each skeleton
   *          in this widget's skeleton source.
   */
  NeuronHistoryWidget.prototype.getNeuronStatistics = function() {
    // For each neuron, get each node along with its history
    var models = this.skeletonSource.getSkeletonModels();
    var skeletonIds = Object.keys(models);

    if (skeletonIds.length === 0) {
      return Promise.resolve([]);
    }

    var maxInactivityTime = this.maxInactivityTime;
    return CATMAID.fetch(project.id + "/skeletons/compact-detail", "POST", {
      skeleton_ids: skeletonIds,
      with_connectors: true,
      with_tags: true,
      with_history: true,
      with_merge_history: true,
      with_reviews: true
    }).then(function(detail) {
      var skeletonStats = [];
      for (var i=0, max=skeletonIds.length; i<max; ++i) {
        var skeletonId = skeletonIds[i];
        var skeletonDetail = detail.skeletons[skeletonId];

        if (!skeletonDetail) {
          CATMAID.warn("No skeleton details on " + skeletonId);
          continue;
        }

        var inputTagLists = [];
        for (var tag in skeletonDetail[3]) {
          inputTagLists.push(skeletonDetail[3][tag]);
        }
        var tags = Array.prototype.concat.apply([], inputTagLists);

        var TS = CATMAID.TimeSeries;
        var availableEvents = {
          nodes: new TS.EventSource(skeletonDetail[0], 8),
          connectors: new TS.EventSource(skeletonDetail[1], 6),
          tags: new TS.EventSource(tags, 2),
          reviews: new TS.EventSource(skeletonDetail[3], 3)
        };

        // Get sorted total events for both reconstruction and review
        // TODO: Count annotations and all writes
        var tracingEvents = TS.mergeEventSources(availableEvents, ["nodes", "connectors", "tags"], 'asc');
        var reviewEvents = TS.mergeEventSources(availableEvents, ["reviews"], 'asc');

        // Calculate tracing time by finding active bouts. Each bout consists of
        // a lists of events that contribute to the reconstruction of a neuron.
        // These events are currently node edits and connector edits.
        var activeTracingBouts = TS.getActiveBouts(tracingEvents, maxInactivityTime);
        var activeReviewBouts = TS.getActiveBouts(reviewEvents, maxInactivityTime);

        // Comput total time intervals
        var totalTime = TS.getTotalTime(activeTracingBouts);
        var reviewTime = TS.getTotalTime(activeReviewBouts);

        // Get first and last review event. Bouts are sorted already, which
        // makes it easy to get min and max time.
        var firstReviewTime, lastReviewTime;
        if (activeReviewBouts.length > 0) {
          firstReviewTime = activeReviewBouts[0].minDate;
          lastReviewTime = activeReviewBouts[activeReviewBouts.length -1].maxDate;
        }
        var reviewAvailable = firstReviewTime && lastReviewTime;

        // Get the sorted history of each node
        var history = TS.makeHistoryIndex(availableEvents, true);

        // Set parent ID of parent nodes that are not available from the index
        // null. This essentially makes them root nodes. Which, however, for a
        // the given point in time is correct.
        TS.setUnavailableReferencesNull(availableEvents.nodes, history.nodes, 1);

        // Review relative arbors
        var arborParserBeforeReview, arborParserAfterReview;
        if (reviewAvailable) {
          arborParserBeforeReview = TS.getArborBeforePointInTime(history.nodes, history.connectors, firstReviewTime);
          // TODO: Is it okay to take "now" as reference or do we need the last
          // review time? I.e. is the final arbor the interesting one or the one
          // right after review?
          arborParserAfterReview = TS.getArborBeforePointInTime(history.nodes, history.connectors, new Date());
        } else {
          // Without reviews, the arbor at its current state is the one before
          // reviews.
          arborParserBeforeReview = TS.getArborBeforePointInTime(history.nodes, history.connectors, new Date());
        }

        // Cable length information
        var cableBeforeReview = "N/A", cableAfterReview = "N/A";
        if (reviewAvailable) {
          cableBeforeReview = Math.round(cableLength(arborParserBeforeReview.arbor,
              arborParserBeforeReview.positions));
          cableAfterReview = Math.round(cableLength(arborParserAfterReview.arbor,
              arborParserAfterReview.positions));
        } else {
          cableBeforeReview = Math.round(cableLength(arborParserBeforeReview.arbor,
              arborParserBeforeReview.positions));
        }

        // Connector information
        var connectorsBeforeReview = "N/A", connectorsAfterReview = "N/A";
        if (reviewAvailable) {
          connectorsBeforeReview = arborParserBeforeReview.n_inputs +
              arborParserBeforeReview.n_presynaptic_sites;
          connectorsAfterReview = arborParserAfterReview.n_inputs +
              arborParserAfterReview.n_presynaptic_sites;
        } else {
          connectorsBeforeReview = arborParserBeforeReview.n_inputs +
              arborParserBeforeReview.n_presynaptic_sites;
        }

        skeletonStats.push({
          skeletonId: skeletonId,
          tracingTime: CATMAID.tools.humanReadableTimeInterval(totalTime),
          reviewTime: CATMAID.tools.humanReadableTimeInterval(reviewTime),
          cableBeforeReview: cableBeforeReview,
          cableAfterReview: cableAfterReview,
          connBeforeReview: connectorsBeforeReview,
          connAfterReview: connectorsAfterReview,
          splitsDuringReview: "?",
          mergesDuringReview: "?"
        });
      }

      return skeletonStats;
    });
  };

  NeuronHistoryWidget.prototype.clear = function() {
    this.skeletonSource.clear();
    this.refresh();
  };

  NeuronHistoryWidget.prototype.refresh = function() {
    if (this.table) {
      this.table.ajax.reload();
    }
  };

  // Export widget
  CATMAID.NeuronHistoryWidget = NeuronHistoryWidget;

  // Register widget with CATMAID
  CATMAID.registerWidget({
    key: 'neuron-history',
    creator: NeuronHistoryWidget
  });

})(CATMAID);
