var fromTracker,
    Promise = require("bluebird"),
    octonode = require("octonode"),
    Client = require("pivotaltracker").Client,
    helpers = require("./helpers"),
    tracker,
    config;


fromTracker = {
  setConfig: function (initialConfig) {
    config = initialConfig;
    tracker = new Client({
      trackerToken: config.auth.tracker,
      pivotalHost: (config.tracker && config.tracker.host) || "www.pivotaltracker.com"
    });
  },

  isStoryWithStateChange: function (promises, changeHash) {
    return changeHash.kind === "story" && changeHash.new_values && changeHash.original_values &&
        (changeHash.new_values.current_state || changeHash.original_values.current_state);
  },

  isStoryWithCommentChange: function (promises, changeHash) {
    return changeHash.kind === "comment";
  },

  updateStateLabelsInGitHub: function (promises, activity, changeHash) {
    var projectId = activity.project.id,
        storyId = changeHash.id,
        qualifiedStory = tracker.project(projectId).story(storyId),
        getter = Promise.promisify(qualifiedStory.get, qualifiedStory),
        wereDonePromise = helpers.emptyPromise(),
        promise = getter(),
        issue;

    promises.push(wereDonePromise);
    promise
        .then(function (story) {
          if (story.integrationId === parseInt(config.tracker.integrationid)) {
            helpers.log("    story (" + story.id + ")'s integrationId (" + story.integrationId + ") matches our configuration");

            var github = octonode.client(config.auth.github);
            issue = github.issue(config.github.repo, story.externalId);

            var fetchInfo = Promise.promisify(issue.info, issue),
                promise = fetchInfo();
            promises.push(promise);
            return promise;
          }
          return Promise.reject("Operation unneeded");
        })
        .then(function (issues) {
          helpers.log("   Matching GitHub issue received");
          var issueHash = issues[0],
              labelToAdd = changeHash.new_values.current_state,
              labelToRemove = changeHash.original_values && changeHash.original_values.current_state,
              labelNames = issueHash.labels.map(function (labelObj) {
                return labelObj.name;
              }),
              newLabelNames = labelNames.filter(function (label) {
                return label !== labelToRemove;
              });
          newLabelNames.push(labelToAdd);

          helpers.log("    original Issue labels were " + labelNames + ", changing to " + newLabelNames);
          var update = { labels: newLabelNames };

          if (changeHash.original_values.current_state !== "accepted" && changeHash.new_values.current_state === "accepted") {
            update.state = "closed";
          }
          else if (changeHash.original_values.current_state === "accepted" && changeHash.new_values.current_state !== "accepted") {
            update.state = "open";
          }

          issue.update(update, function (error) {
            if (error) {
              helpers.log("    update to GitHub " + (error === null ? "succeeded" : "failed"));
              helpers.log(" -- ERROR RESPONSE from GitHub --");
              helpers.log(error);
            }
            wereDonePromise.resolve();
          });
        })
        .catch(function (error) {
          helpers.log(" -- CAUGHT EXCEPTION -- ");
          helpers.log(error);
          helpers.log(error.stack);
        });
  },

  updateCommentsInGitHub: function (promises, activity, changeHash) {
    var projectId = activity.project.id,
      user = activity.performed_by,
      storyId = changeHash.new_values.story_id,
      qualifiedStory = tracker.project(projectId).story(storyId),
      getter = Promise.promisify(qualifiedStory.get, qualifiedStory),
      wereDonePromise = helpers.emptyPromise(),
      promise = getter(),
      issue;

    promises.push(wereDonePromise);
    promise
      .then(function (story) {
        if (story.integrationId === parseInt(config.tracker.integrationid)) {
          helpers.log("    story (" + story.id + ")'s integrationId (" + story.integrationId + ") matches our configuration");

          var github = octonode.client(config.auth.github);
          issue = github.issue(config.github.repo, story.externalId);

          var fetchInfo = Promise.promisify(issue.info, issue),
            promise = fetchInfo();
          promises.push(promise);
          return promise;
        }
        return Promise.reject("Operation unneeded");
      })
      .then(function (issues) {
        helpers.log("   Matching GitHub issue received");

        if (changeHash.change_type === "create") {

          if (changeHash.new_values.text.indexOf("(comment in GitHub ") === 0) {
            helpers.log("    skipping; comment already created in GitHub");
            wereDonePromise.resolve();
            return;
          }

          var newComment = {
            "body": "(comment in Pivotal Tracker added by " + user.name + ":) \n\n" + changeHash.new_values.text
          };

          // create new comment
          issue.createComment(newComment, function (error) {
            if (error) {
              helpers.log("    comment creation on GitHub " + (error === null ? "succeeded" : "failed"));
              helpers.log(" -- ERROR RESPONSE from GitHub --");
              helpers.log(error);
            }
            wereDonePromise.resolve();
          });
        }
        else if (changeHash.change_type === "delete") {
          helpers.log("   deleting comments in GitHub not yet supported");
        }
        else if (changeHash.change_type === "changed") {
          helpers.log("   changing comments in GitHub not yet supported");
        }
      })
      .catch(function (error) {
        helpers.log(" -- CAUGHT EXCEPTION -- ");
        helpers.log(error);
        helpers.log(error.stack);
      });

  }

};

module.exports = fromTracker;
