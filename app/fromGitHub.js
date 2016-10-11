var _ = require("lodash"),
    Promise = require("bluebird"),
    Client = require("pivotaltracker").Client,
    helpers = require("./helpers"),
    trackerStateNames = [
      "unscheduled", "unstarted", "started", "finished",
      "delivered", "rejectd", "accepted"
    ],
    fromGitHub,
    tracker,
    config;

fromGitHub = {
  setConfig: function (initialConfig) {
    config = initialConfig;
    tracker = new Client({
      trackerToken: config.auth.tracker,
      pivotalHost: (config.tracker && config.tracker.host) || "www.pivotaltracker.com"
    });
  },

  isIssueWithLabelChange: function (webhook) {
    return webhook && (webhook.action === "labeled" || webhook.action === "unlabeled");
  },

  isIssueComment: function (webhook) {
    return webhook && webhook.comment && (webhook.action === "created");
  },

  updateStoryLabelsInTracker: function (webhook) {
    var action = (webhook.action === "labeled") ? "added" : "removed",
        direction = (webhook.action === "labeled") ? "to" : "from",
        changedLabel = webhook.label.name,
        issueId = webhook.issue.number;
    helpers.log("    " + action + " label '" + changedLabel + "' " + direction + " GitHub Issue #" + issueId);
    if (trackerStateNames.indexOf(changedLabel) > -1) {
      helpers.log("    skipping state label");
      return Promise.resolve();
    }

    var qualifiedProject = tracker.project(config.tracker.projectid),
        searcher = Promise.promisify(qualifiedProject.search, qualifiedProject),
        projectSearchPromise = searcher("external_id:" + issueId + " includedone:true"),
        wereDonePromise = helpers.emptyPromise();

    projectSearchPromise.then(function (result) {
      var storyHash = result.stories[0];
      if (!storyHash || !storyHash.id) {
        helpers.log("    skipping; can't find matching story in Tracker");
        wereDonePromise.resolve();
        return;
      }

      var storyId = storyHash.id,
          changedLabelPresent = storyHash.labels.some(function (labelHash) {
            return labelHash.name === changedLabel;
          });

      helpers.log("    for GH issue " + issueId + ", the Tracker story is #" + storyId);

      var qualifiedStory =
              tracker.project(config.tracker.projectid).story(storyId),
          updater = Promise.promisify(qualifiedStory.update, qualifiedStory),
          newInfo;
      if (webhook.action === "labeled") {
        if (changedLabelPresent) {
          helpers.log("    skipping add of existing label");
          wereDonePromise.resolve();
        } else {
          storyHash.labels.push({ name: changedLabel });

          newInfo = {
            labels: storyHash.labels
          };
          helpers.log("    updating Tracker story #" + storyId + " with revised label hashes " + newInfo);
          wereDonePromise.resolve(updater(newInfo));
        }
      } else if (webhook.action === "unlabeled") {
        if (!changedLabelPresent) {
          helpers.log("    skipping remove of missing label");
          wereDonePromise.resolve();
        } else {
          newInfo = {
            labels: _.select(storyHash.labels, function (labelHash) {
              return labelHash.name !== changedLabel;
            })
          };
          helpers.log("    updating Tracker story #" + storyId + " with revised label hashes " + newInfo);
          wereDonePromise.resolve(updater(newInfo));
        }
      } else {
        throw new Error("Internal error:  processing label add/remove, but action was " + webhook.action);
      }
    }).catch(function (e) {
      helpers.log(e);
    });

    return wereDonePromise;
  },

  updateCommentsInTracker: function (webhook) {
    var comment = webhook.comment,
        issueId = webhook.issue.number;

    helpers.log("    " + webhook.action + " comment '" + comment.body + "' to GitHub Issue #" + issueId);

    var qualifiedProject = tracker.project(config.tracker.projectid),
        searcher = Promise.promisify(qualifiedProject.search, qualifiedProject),
        projectSearchPromise = searcher("external_id:" + issueId + " includedone:true"),
        wereDonePromise = helpers.emptyPromise();

    projectSearchPromise.then(function (result) {
      var storyHash = result.stories[0];
      if (!storyHash || !storyHash.id) {
        helpers.log("    skipping; can't find matching story in Tracker");
        wereDonePromise.resolve();
        return;
      }

      var storyId = storyHash.id;
      helpers.log("    for GH issue " + issueId + ", the Tracker story is #" + storyId);

      var qualifiedStory =
              tracker.project(config.tracker.projectid).story(storyId),
          comments = qualifiedStory.comments,
          updater = Promise.promisify(comments.create, comments),
          newComment;

      if (webhook.action === "created") {

        if (comment.body.startsWith("(comment in Pivotal Tracker ")) {
          helpers.log("    skipping; comment already created in tracker");
          wereDonePromise.resolve();
          return;
        }

        newComment = {
          text: "(comment in GitHub added by " + comment.user.login + ":) \n\n" + comment.body
        };

        helpers.log("    adding new comment to Tracker story #" + storyId);
        wereDonePromise.resolve(updater(newComment));
      } else {
        throw new Error("Internal error:  processing comment add/remove, but action was " + webhook.action);
      }
    }).catch(function (e) {
      helpers.log(e);
    });

    return wereDonePromise;
  }

};

module.exports = fromGitHub;
