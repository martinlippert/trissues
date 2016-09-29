var restify = require("restify"),
    config = require("environmental").config().trissues,
    xml = require("xml"),
    Promise = require("bluebird"),
    helpers = require("./helpers"),
    fromGitHub = require("./fromGitHub"),
    fromTracker = require("./fromTracker"),

    trackerIps = [
      "67.214.223.6", "67.214.223.25", "208.85.150.190", "208.85.150.184",
      "67.214.223.7", "67.214.223.21", "208.85.150.188", "208.85.150.177"
    ];

function finishRequest(promises, res, next) {
  if (promises.length === 0) {
    promises.push(Promise.resolve());
  }
  Promise.settle(promises).then(function () {
    helpers.log("    sending response with status 200");
    res.send(200);
    return next();
  });
}

module.exports = {
  githubissues: function (req, res, next) {
    helpers.log("GET request for importable stories through /githubissues");
    var client = restify.createJsonClient({
      url: "https://api.github.com/",
      headers: {
        Authorization: "token " + config.auth.github
      }
    }),
    filteredLabels = (function () {
      if (config.exclude && config.exclude.labels) {
        return config.exclude.labels.split(/, */);
      } else {
        return [];
      }
    }());
    client.get("/repos/" + config.github.repo + "/issues", function (err, githubReq, githubRes, issues) {
      helpers.log("    Received " + issues.length + " issues from GitHub");

      var responseObj = {
        external_stories: [{ _attr: { type: "array" } }]
      };

      issues.forEach(function (issue) {
        if (!issue.labels.some(
          function (label) {
            return filteredLabels.indexOf(label.name) !== -1;
          })) {
          var externalStory = [
            { external_id: issue.number },
            { story_type: "feature" },
            { name: issue.title },
            { requested_by: issue.user.login },
            { created_at: [{ _attr:{ type: "datetime" } }, issue.created_at] }
          ];

          if ((issue.body || "") !== "") {
            externalStory.push({ description: issue.body });
          }

          if (issue.assignee) {
            externalStory.push({ owned_by: issue.assignee.login });
          }
          responseObj.external_stories.push({ external_story: externalStory });
        }
      });

      res.contentType = "application/xml";
      res.send(200, xml(responseObj, { declaration: true }));
      helpers.log("    Responding with " + responseObj.external_stories.length + " Tracker external stories");
      return next();
    });
  },

  fromgithub: function (req, res, next) {
    helpers.log("POST request to /fromgithub");

    var promises = [],
        webhook = req.body;
    fromGitHub.setConfig(config);
    if (fromGitHub.isIssueWithLabelChange(webhook)) {
      var p = fromGitHub.updateStoryLabelsInTracker(webhook);
      promises.push(p);
    }
    finishRequest(promises, res, next);
  },

  fromtracker: function (req, res, next) {
    helpers.log("POST request to /fromtracker");

    var header = req.header("x-forwarded-for") || req.connection.remoteAddress;
    var ipAddresses = header.split(/\s*,\s*/);

    var validAddress = false;

    ipAddresses.forEach(function(ipAddress) {
      var trimmedAddress = ipAddress.replace(" ", "");
      if (trackerIps.indexOf(trimmedAddress) > -1) {
        validAddress = true;
      }
    });

    if (!validAddress) {
      helpers.log("    WARNING:  request from unknown IP address " + ipAddress + ", responding with 403");
      res.send(403);
      return next();
    }

    var promises = [],
        activity = req.body;
    fromTracker.setConfig(config);

    helpers.log("    Tracker '" + activity.kind + "' activity item contains " + activity.changes.length + " resource change(s)");
    activity.changes.forEach(function (changeHash) {
      if (fromTracker.isStoryWithStateChange(promises, changeHash)) {
        helpers.log("    state change to story " + changeHash.id);
        fromTracker.updateStateLabelsInGitHub(promises, activity, changeHash);
      }
    });

    finishRequest(promises, res, next);
  }
};
