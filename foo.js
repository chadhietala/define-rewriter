(function () {
  var registry = {
    "a": {},
    "b": {}
  };

  (function (exports) {
    exports.default = "b";
  })(registry["b"]);

  (function (exports, b) {
    exports.default = "a";
  })(registry["a"], registry["b"]);
})();