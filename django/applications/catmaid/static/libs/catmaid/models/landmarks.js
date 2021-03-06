/* -*- mode: espresso; espresso-indent-level: 2; indent-tabs-mode: nil -*- */
/* vim: set softtabstop=2 shiftwidth=2 tabstop=2 expandtab: */

(function(CATMAID) {

  "use strict";

  /**
   * This namespace provides functions to work with labels on nodes. All of them
   * return promises.
   */
  var Landmarks = {

    /**
     * List all landmarks in a project, optionally with location information.
     */
    list: function(projectId, with_locations) {
      return CATMAID.fetch(project.id +  "/landmarks/", "GET", {
          with_locations: with_locations
        });
    },

    /**
     * Get details on a landmark.
     */
    get: function(projectId, landmarkId, with_locations) {
      return CATMAID.fetch(projectId + '/landmarks/' + landmarkId + '/', 'GET', {
        with_locations: !!with_locations
      });
    },

    /**
     * Create a new landmark with the specified name.
     */
    add: function(projectId, name) {
      return CATMAID.fetch(projectId + '/landmarks/', 'PUT', {
          name: name
        });
    },

    /**
     * Delete an existing landmark with the passed in ID.
     */
    delete: function(projectId, landmarkId) {
      return CATMAID.fetch(projectId + '/landmarks/' + landmarkId + '/', 'DELETE');
    },

    /**
     * Delete all passed in landmarks.
     */
    deleteAll: function(projectId, landmarkIds) {
      return CATMAID.fetch(projectId + '/landmarks/', 'DELETE', {
        landmark_ids: landmarkIds
      });
    },

    /**
     * List all landmark groups in a project, optionally with location
     * information. Optionally, with member and location information.
     */
    listGroups: function(projectId, with_members, with_locations) {
      return CATMAID.fetch(project.id +  "/landmarks/groups/", "GET", {
          with_members: with_members,
          with_locations: with_locations
        });
    },

    /**
     * Get details on a landmark group.
     */
    getGroup: function(projectId, groupId, with_members, with_locations) {
      return CATMAID.fetch(projectId + '/landmarks/groups/' + groupId + '/', 'GET', {
          with_members: !!with_members,
          with_locations: !!with_locations
        });
    },

    /**
     * Create a new group with the specified name.
     */
    addGroup: function(projectId, name) {
      return CATMAID.fetch(projectId + '/landmarks/groups/', 'PUT', {
          name: name
        });
    },

    /**
     * Delete a landmark group. This requires can_edit permissions for the
     * requesting user on that landmark group.
     */
    deleteGroup: function(projectId, groupId) {
      return CATMAID.fetch(projectId + '/landmarks/groups/' + groupId + '/', 'DELETE');
    },

    /**
     * Update the landmarks linked to a particular landmark group. If <append>
     * is true, the passed in member IDs will be appended if not already
     * present.
     */
    updateGroupMembers: function(projectId, groupId, newMemberIds) {
      return CATMAID.fetch(projectId + '/landmarks/groups/' + groupId + '/', 'POST', {
        members: newMemberIds.length === 0 ? 'none' : newMemberIds
      });
    },

    /**
     * Link a landmark to a location. Landmarks can be part of multiple landmark
     * groups to represent that as logical entity a landmark is found in
     * multiple places or contextes. Linking a landmark to a location gives a
     * type to the landmark, but its context/group has to be sed separetyle.
     */
    linkNewLocationToLandmark: function(projectId, landmarkId, location) {
      return CATMAID.fetch(projectId + '/landmarks/' + landmarkId + '/locations/', 'PUT', {
          x: location.x,
          y: location.y,
          z: location.z
        });
    },

    /**
     * Delete the link between the passed in landmark and location.
     */
    deleteLocationLink: function(projectId, landmarkId, locationId) {
      return CATMAID.fetch(projectId + '/landmarks/' + landmarkId +
        '/locations/' + locationId + '/', 'DELETE');
    },

    /**
     * Add a point location to a landmark group if the location is also linked to
     * by the landmark.
     */
    addLandmarkLocationToGroup: function(projectId, groupId, locationId) {
      return CATMAID.fetch(projectId + '/landmarks/groups/' + groupId +
          '/locations/' + locationId + '/', 'PUT');
    },

    /**
     * Remove the link between a point location and a landmark group when the
     * location is also linked to the landmark.
     */
    removeLandmarkLocationFromGroup: function(projectId, groupId, locationId) {
      return CATMAID.fetch(projectId + '/landmarks/groups/' + groupId +
          '/locations/' + locationId + '/', 'DELETE');
    },

    /**
     * Import and link landmarks, landmark groups and locations. The passed in
     * <data> parameter is a list of two-element lists, each representing a
     * group along with its linked landmark and locations. The group is
     * represented by its name and the members are a list of four-element lists,
     * containing the landmark name and the location. This results in the
     * following format:
     *
     *  [[group_1_name, [[landmark_1_name, x, y, z], [landmark_2_name, x, y, z]]], ...]
     */
    import: function(projectId, data, reuse_existing_groups,
        reuse_existing_landmarks, create_non_existing_groups,
        create_non_existing_landmarks) {
      return CATMAID.fetch(projectId + '/landmarks/groups/import', 'POST', {
        data: JSON.stringify(data),
        reuse_existing_groups: CATMAID.tools.getDefined(reuse_existing_groups, false),
        reuse_existing_landmarks: CATMAID.tools.getDefined(reuse_existing_landmarks, false),
        create_non_existing_groups: CATMAID.tools.getDefined(create_non_existing_groups, true),
        create_non_existing_landmarks: CATMAID.tools.getDefined(create_non_existing_landmarks, true)
      });
    }

  };

  let LandmarkSkeletonTransformation = function(skeletons, fromGroupId, toGroupId) {
    this.skeletons = skeletons;
    this.fromGroupId = parseInt(fromGroupId, 10);
    this.toGroupId = parseInt(toGroupId, 10);
    this.id = CATMAID.tools.uuidv4();
  };

  // Export namespace
  CATMAID.Landmarks = Landmarks;
  CATMAID.LandmarkSkeletonTransformation = LandmarkSkeletonTransformation;

})(CATMAID);
