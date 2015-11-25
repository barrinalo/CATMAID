/* global
 project,
 fetchSkeletons,
 SkeletonAnnotations
*/

"use strict";

var SynapsePlot = function() {
  this.widgetID = this.registerInstance();
  this.registerSource();

  // Each entry has an array of unique skeleton ids
  this.pre = {};
  this.post = {};

  // skeleton_id vs SkeletonModel, for postsynaptic neurons added via "append"
  this.models = {};

  // Skeleton data for skeletons in this.models, including the arbor and the "ais_node" marking the axon initial segment
  this.morphologies = {};

  // List skeletons for which there are at least these many synapses
  this.threshold = 1;

  // List of presynaptic skeletons to show. When null, show all.
  this.only = null;

  // Method for finding the skeleton treenode where the axon starts
  this.ais_method = this.AIS_COMPUTED;
  this.ais_tag = "";

  // The processed but unfiltered data to show in the plot, stored so that redraws for resizing are trivial.
  this.rows = null;

  // In percent of the row height
  this.jitter = 0.25;

  // For coloring according to pre_skids
  this.pre_models = {};
};

SynapsePlot.prototype = {};
$.extend(SynapsePlot.prototype, new InstanceRegistry());
$.extend(SynapsePlot.prototype, new CATMAID.SkeletonSource());

SynapsePlot.prototype.getName = function() {
  return "Synapse Distribution Plot " + this.widgetID;
};

SynapsePlot.prototype.AIS_COMPUTED = 1;
SynapsePlot.prototype.AIS_TAG = 2;

SynapsePlot.prototype.destroy = function() {
  this.clear();
  this.unregisterInstance();
  this.unregisterSource();
  CATMAID.NeuronNameService.getInstance().unregister(this);
};

SynapsePlot.prototype.getSelectedSkeletons = function() {
  return Object.keys(this.models);
};

SynapsePlot.prototype.getSkeletons = SynapsePlot.prototype.getSelectedSkeletons;

SynapsePlot.prototype.getSkeletonColor = function(skid) {
  var skeleton = this.models[skid];
  if (skeleton) return skeleton.color.clone();
  return new THREE.Color();
};

SynapsePlot.prototype.hasSkeleton = function(skid) {
  return this.models.hasOwnProperty(skid);
};

SynapsePlot.prototype.getSkeletonModel = function(skid) {
  var model = this.models[skid];
  if (model) return model.clone();
};

SynapsePlot.prototype.getSkeletonModels = function() {
  return Object.keys(this.models).reduce((function(m, skid) {
    m[skid] = this[skid].clone();
    return m;
  }).bind(this.models), {});
};

SynapsePlot.prototype.getSelectedSkeletonModels = SynapsePlot.prototype.getSkeletonModels;

SynapsePlot.prototype.update = function() {
  var models = this.models;
  this.clear();
  this.append(models);
};

SynapsePlot.prototype.resize = function() {
  this.redraw();
};

SynapsePlot.prototype.updateNeuronNames = function() {
  this.redraw();
};

SynapsePlot.prototype.clear = function() {
  this.models = {};
  this.morphologies = null;
  this.rows = null;
  this.redraw();
};

SynapsePlot.prototype._registerModels = function(models) {
  Object.keys(models).forEach(function(skid) {
    this.models[skid] = models[skid];
  }, this);
};

SynapsePlot.prototype.append = function(models) {
  CATMAID.NeuronNameService.getInstance().registerAll(this, models,
      (function() { this._append(models); }).bind(this));
};

SynapsePlot.prototype._append = function(models) {
  var existing = this.models;

  var to_add = Object.keys(models).reduce(function(o, skid) {
    if (existing.hasOwnProperty(skid)) {
      existing[skid] = models[skid]; // update: might make it invisible, change color, etc
    } else {
      o[skid] = models[skid];
    }
    return o;
  }, {});

  var skids = Object.keys(to_add);
  if (0 === skids.length) return;

  this.morphologies = {};

  fetchSkeletons(
      skids,
      function(skid) { return django_url + project.id + '/' + skid + '/1/1/1/compact-arbor'; },
      function(skid) { return {} }, // POST
      (function(post_skid, json) {
        // register
        this.models[post_skid] = models[post_skid];
        // Parse arbor and positions
        var ap = new CATMAID.ArborParser().init("compact-arbor", json);
        // Parse synapses
        // 1. Map of postsynaptic treenode ID vs (map of presynaptic skeleton IDs vs true).
        var posts = {};
        // 2. Map of skeleton ID vs number of presynaptic synapses onto post_skid, to be used for filtering.
        var counts = {};
        var cs = json[1];
        for (var i=0; i<cs.length; ++i) {
          var c = cs[i]; // one connection
          if (0 === c[6]) continue; // presynaptic
          var treenodeID = c[0];
          var pre_skid = c[5];
          // Get the map of skeleton ID vs number of synaptic relations at treenodeID
          var uskids = posts[treenodeID];
          if (!uskids) {
            uskids = {};
            posts[treenodeID] = uskids;
          }
          // A skeleton could be making from than one synapse at the same treenodeID
          var num = uskids[pre_skid];
          uskids[pre_skid] = (num ? num : 0) + 1;
          // Count the total number of synapses from the pre_skid
          var count = counts[pre_skid];
          counts[pre_skid] = (count ? count : 0) + 1;
        }

        this.morphologies[post_skid] = {ap: ap,
                                        positions: ap.positions,
                                        posts: posts,
                                        counts: counts,
                                        tags: json[2]};
      }).bind(this),
      (function(skid) {
        // Failed to load
        delete this.models[skid];
        delete this.morphologies[skid];
      }).bind(this),
      (function() { this.updateGraph(); }).bind(this));
};

SynapsePlot.prototype.onchangeSynapseThreshold = function(ev) {
  // Get the number from the event soure, which is a textfield
  var val = Number(ev.srcElement.value);
  if (Number.isNaN(val)) {
    CATMAID.msg("Warning", "Invalid threshold value: not a number.");
    return;
  }

  if (val !== this.threshold) {
    this.threshold = val;
    this.updateGraph();
  }
};

SynapsePlot.prototype.onchangeFilterPresynapticSkeletons = function() {
  var source = CATMAID.skeletonListSources.getSelectedPushSource(this, "filter");
  if (source) {
    this.only = source.getSelectedSkeletons().reduce(function(o, skid) { o[skid] = true; return o; }, {});
  } else {
    this.only = null;
  }
  this.updateGraph();
};

SynapsePlot.prototype.onchangeChoiceAxonInitialSegment = function(select, field) {
  if ("Computed" === select.value) {
    // Compute by synapse flow centrality, and take the most proximal node
    this.ais_method = this.AIS_COMPUTED;
    this.updateGraph();
  } else if ("Node tagged with..." === select.value) {
    // Ask for a choice of tag
    this.ais_method = this.AIS_TAG;
    this.onchangeAxonInitialSegmentTag(field);
  }
};

SynapsePlot.prototype.onchangeAxonInitialSegmentTag = function(field) {
  this.ais_tag = field.value.trim();
  if (this.ais_method === this.AIS_TAG) {
    if ("" == this.ais_tag) {
      CATMAID.msg("Information", "Write in the name of a tag");
      return;
    }
    this.updateGraph();
  }
};

SynapsePlot.prototype.onchangeJitter = function(field) {
  var jitter = Number(field.value.trim());
  if (Number.isNaN(jitter)) {
    CATMAID.msg("Warning", "Invalid jitter value");
    return;
  }
  if (this.jitter === jitter) return;
  // Clamp to range [0, 0.5]
  if (jitter > 0.5) {
    jitter = 0.5;
  } else if (jitter < 0) {
    jitter = 0;
  }
  $("#synapse_plot_jitter" + this.widgetID).val(jitter);
  this.jitter = jitter;
  this.redraw();
};

SynapsePlot.prototype.onchangeColoring = function(select) {
  var source = CATMAID.skeletonListSources.getSelectedPushSource(this, "coloring");
  this.pre_models = source ? source.getSelectedSkeletonModels() : {};
  this.redraw();
};

/** Return the treenode ID of the most proximal node of the axon initial segment, or null if not findable. */
SynapsePlot.prototype.findAxonInitialSegment = function(morphology) {
  // Method 1:
  if (this.AIS_COMPUTED === this.ais_method) {
    // Same algorithm as in the 3D Viewer
    var axon = SynapseClustering.prototype.findAxon(
        morphology.ap,
        0.9,
        morphology.positions);
    if (axon) return axon.root;
    return null;
  }

  // Method 2:
  if (this.AIS_TAG === this.ais_method) {
    var nodes = morphology.tags[this.ais_tag];
    if (nodes) {
      if (1 === nodes.length) return nodes[0];
      CATMAID.ms("Warning", "More than one node tagged with '" + this.ais_tag + "'");
      return null
    } else {
      CATMAID.msg("Warning", "Could not find a node tagged with '" + this.ais_tag + "'");
      return null;
    }
  }
};

SynapsePlot.prototype.updateGraph = function() {
  if (0 === Object.keys(this.models)) return;

  // For filtering
  var accept = (function(pre_skid, counts) {
    if (!this.only || this.only[pre_skid]) {
      if (counts >= this.threshold) {
        return true;
      }
    }
    return false;
  }).bind(this);

  // Compute distances to the axon initial segment of the postsynaptic neurons
  // Map of presynaptic skeleton IDs vs postsynaptic sites on postsynaptic neurons
  var postsynaptic_sites = {};

  Object.keys(this.morphologies).forEach(function(post_skid) {
    var morphology = this.morphologies[post_skid];
    var ais_node = this.findAxonInitialSegment(morphology);
		morphology.ais_node = ais_node; // store even if null
    if (!ais_node) {
      CATMAID.msg("Warning", "Could not find the axon initial segment for " + CATMAID.NeuronNameService.getInstance().getName(post_skid));
      return;
    }
    // The arbor, pruned and rerooted at the axon initial segment (ais_node)
    var arbor = morphology.ap.arbor.clone();
    Object.keys(arbor.subArbor(ais_node).edges).forEach(function(node) {
      delete arbor.edges[node];
    });
    arbor.reroot(ais_node);
    //
    var distances = arbor.nodesDistanceTo(ais_node,
      (function(child, paren) {
        return this[child].distanceTo(this[paren]);
      }).bind(morphology.positions)).distances;
    // Define synapses
    // for each treenodeID in the post_skid
    Object.keys(morphology.posts).forEach(function(treenodeID) {
      var distance = distances[treenodeID];
      if (!distance) return; // not part of the dendrite
      var pre_skids = morphology.posts[treenodeID];
      // for each pre_skid that synapses onto post_skid at treenodeID
      Object.keys(pre_skids).forEach(function(pre_skid) {
        // Filter
        if (!accept(pre_skid, morphology.counts[pre_skid])) return;
        //
        var p = postsynaptic_sites[pre_skid];
        if (!p) {
          p = [];
          postsynaptic_sites[pre_skid] = p;
        }
        // for each synapse that pre_skid makes onto post_skid at treenodeID
        // (could be more than 1, but most will be just 1)
        for (var i=0, count=pre_skids[pre_skid]; i<count; i++) {
          p.push({distance: distance,
                  treenodeID: treenodeID,
                  post_skid: post_skid,
                  pre_skid: pre_skid});
        }
      });
    });
  }, this);

  // For each pre_skid in postsynaptic_sites, make a row in the graph.
  // First, sort descending from more to less synapses onto the post_skids
  var sorted = Object.keys(postsynaptic_sites).map(function(pre_skid) {
    return {pre_skid: pre_skid,
            posts: postsynaptic_sites[pre_skid]};
  }).sort(function(a, b) {
    var al = a.posts.length,
        bl = b.posts.length;
    return al === bl ? 0 : (al < bl ? 1 : -1);
  });

  this.rows = sorted;
  
  this.redraw();
};

SynapsePlot.prototype.redraw = function() {
  var containerID = '#synapse_plot' + this.widgetID,
      container = $(containerID);

  // Clear prior graph if any
  container.empty();

  // Stop if empty
  if (!this.rows || 0 === this.rows.length) return;

  // Load names of pre_skids
  CATMAID.NeuronNameService.getInstance().registerAll(
      this,
      this.rows.reduce(function(m, pre) {
        m[pre.pre_skid] = new CATMAID.SkeletonModel(pre.pre_skid, "", new THREE.Color());
        return m;
      }, {}),
      (function() { this._redraw(container, containerID); }).bind(this));
};

SynapsePlot.prototype._redraw = function(container, containerID) {
  // Upper bound of the X axis range
  var max_dist = 0;
  this.rows.forEach(function(pre) {
    pre.posts.forEach(function(post) {
      max_dist = Math.max(max_dist, post.distance);
    });
  });

  var margin = {top: 20, right: 20, bottom: 50, left: 150},
      width = container.width() - margin.left - margin.right,
      height = container.height() - margin.top - margin.bottom;

  var svg = d3.select(containerID).append("svg")
          .attr("id", 'svg_' + containerID)
          .attr("width", width + margin.left + margin.right)
          .attr("height", height + margin.top + margin.bottom)
          .append("g")
          .attr("transform", "translate(" + margin.left + "," + margin.top + ")");

  var x = d3.scale.linear().domain([0, max_dist]).range([0, width]),
      y = d3.scale.linear().domain([0, this.rows.length -1]).range([height, 0]); // domain starts at 1

  var xAxis = d3.svg.axis().scale(x).orient("bottom"),
      yAxis = d3.svg.axis().scale(y)
                .ticks(this.rows.length + 1)
                .tickFormat((function(i) {
                  if (!this.rows[i] || !this.rows[i].pre_skid) {
                    return "";
                  }
                  return CATMAID.NeuronNameService.getInstance().getName(this.rows[i].pre_skid);
                }).bind(this))
                .orient("left");

  var state = svg.selectAll(".state")
                 .data(this.rows)
                 .enter()
                 .append('g')
                   .attr('class', 'g') // one row, representing one pre_skid
                   .attr('transform', function(d, i) {
                     return "translate(0," + y(i) + ")";
                   });

  state.selectAll("circle")
       .data(function(pre) { // for each pre_skid
         return pre.posts;
       })
       .enter() // for each postsynaptic site
         .append("circle")
         .attr('class', 'dot')
         .attr('r', '3')
         .attr("cx", function(post) {
           return x(post.distance);
         })
         .attr("cy", (function(post) {
           // y(1) - y(0) gives the height of the horizonal row used for a pre_skid,
           // then jitter takes a fraction of that, and Math.random spreads the value within that range.
           return ((y(1) - y(0)) * this.jitter) * (Math.random() - 0.5);
         }).bind(this))
         .style('fill', (function(post) {
           // Default is to color according to post_skid,
           // but will color according to pre_skid if present in this.pre_models.
           // (see this.onchangeColoring)
           var pre_model = this.pre_models[post.pre_skid];
           var model = pre_model ? pre_model : this.models[post.post_skid];
           return '#' + model.color.getHexString();
         }).bind(this))
         .style('stroke', 'black')
         .on('click', function(post) {
           SkeletonAnnotations.staticMoveToAndSelectNode(post.treenodeID);
         })
         .append('svg:title') // on mouse over
           .text(function(post) {
             return CATMAID.NeuronNameService.getInstance().getName(post.post_skid);
           });

    var xg = svg.append("g")
        .attr("class", "x axis")
        .attr("transform", "translate(0," + (height + 10) + ")") // translated down a bit
        .attr("fill", "none")
        .attr("stroke", "black")
        .style("shape-rendering", "crispEdges")
        .call(xAxis);
    xg.selectAll("text")
        .attr("fill", "black")
        .attr("stroke", "none");
    xg.append("text")
        .attr("x", width)
        .attr("y", -6)
        .attr("fill", "black")
        .attr("stroke", "none")
        .attr("font-family", "sans-serif")
        .attr("font-size", "11px")
        .style("text-anchor", "end")
        .text("distance (nm)");

    var yg = svg.append("g")
        .attr("class", "y axis")
        .attr("fill", "none")
        .attr("stroke", "black")
        .style("shape-rendering", "crispEdges")
        .call(yAxis);
    yg.selectAll("text")
        .attr("fill", "black")
        .attr("stroke", "none");
    yg.append("text")
        .attr("fill", "black")
        .attr("stroke", "none")
        .attr("transform", "rotate(-90)")
        .attr("font-family", "sans-serif")
        .attr("font-size", "11px")
        .attr("y", 6)
        .attr("dy", ".71em")
        .style("text-anchor", "end");

    var legend = svg.selectAll(".legend")
      .data(Object.keys(this.models))
      .enter()
        .append("g")
        .attr("class", "legend")
        .attr("transform", function(d, i) { return "translate(0," + i * 20 + ")"; })
        .on("click", (function(skid) {
					var ais_node = this.morphologies[skid].ais_node;
					if (!ais_node) {
						CATMAID.msg("Warning", "No axon initial segment found for " + CATMAID.NeuronNameService.getInstance().getName(skid));
					} else {
						SkeletonAnnotations.staticMoveToAndSelectNode(ais_node);
					}
				}).bind(this));

    legend.append("rect")
      .attr("x", width - 18)
      .attr("width", 18)
      .attr("height", 18)
      .style("fill", (function(skid) { return '#' + this.models[skid].color.getHexString(); }).bind(this));

    legend.append("text")
      .attr("x", width - 24)
      .attr("y", 9)
      .attr("dy", ".35em")
      .style("text-anchor", "end")
      .text(function(skid) { return CATMAID.NeuronNameService.getInstance().getName(skid); })
};

SynapsePlot.prototype.highlight = function(skid) {
  // TODO
};

SynapsePlot.prototype.exportCSV = function() {
  if (!this.rows) {
    CATMAID.msg("Warning", "Nothing to export to CSV.");
    return;
  }
  var csv = ["post_skeletonID,pre_skeletonID,post_treenodeID,distance_to_AIS"]
    .concat(this.rows.reduce(function(a, pre) {
    return pre.posts.reduce(function(a, post) {
      return a.concat([post.post_skid, post.pre_skid, post.treenodeID, post.distance].join(","));
    }, a);
  }, [])).join('\n');
  saveAs(new Blob([csv], {type: "text/csv"}), "synapse_distribution.csv");
};

SynapsePlot.prototype.exportSVG = function() {
  CATMAID.svgutil.saveDivSVG('synapse_plot_widget' + this.widgetID, "synapse_distribution_plot.svg");
};

