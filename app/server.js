var config = require("environmental").config().trissues,
  restify = require("restify"),
  helpers = require("./helpers"),
  handlers = require("./handlers");

function launch() {
  //  var port =  process.env.PORT || config.server.port || 8001,
  var port = process.env.PORT || 8001,
    server = restify.createServer({
      name: "trissues",
      version: "0.0.0"
    });

  server.use(restify.bodyParser());
  server.get("/githubissues", handlers.githubissues);
  server.post("/fromtracker", handlers.fromtracker);
  server.post("/fromgithub", handlers.fromgithub);
  server.listen(parseInt(port));
  helpers.log("Server running at http://127.0.0.1:" + port + "/  (" + process.env.NODE_ENV + " mode)");
  helpers.log("Config", config);
  helpers.log("process env", process.env);
}

module.exports = { launch: launch };
