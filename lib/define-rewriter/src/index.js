'use strict';
/* jshint node:true */
var Filter = require('broccoli-persistent-filter');
var babylon = require('babylon');
var traverse = require('babel-traverse').default;
var ModuleGraph = require('./module_graph');
var fs = require('fs');
var path = require('path');

/**
 * NOTES
 * Need to register modules into requirejs._eak_seen with a shape that looks
 * like the follow:
 *
 * (name: string) = {
 *  deps: string[]
 *  callback: Function
 * }
 *
 * enifed
 */
function DefineRewriter(inputNode, options) {
  if (options && options.eagerLoad) {
    if (Array.isArray(options.eagerLoad)) {
      this.eagerLoad = options.eagerLoad;
    } else {
      this.eagerLoad = [ options.eagerLoad ];
    }
  } else {
    this.eagerLoad = ['ember', 'ember-htmlbars/system/render-view', 'ember-metal/streams/key-stream'];
  }
  Filter.call(this, inputNode, options);
}

DefineRewriter.prototype = Object.create(Filter.prototype);
DefineRewriter.prototype.constructor = DefineRewriter;

var EMBER_PATHS = {
  'ember/ember.prod.js': true, 'ember/ember.debug.js': true
};

DefineRewriter.prototype.processString = function(string, relativePath) {
  if (!EMBER_PATHS[relativePath]) {
    return string;
  }
  var ast = babylon.parse(string);

  var blockStatementPath;
  var first = -1;
  var count =  0;
  var graph = new ModuleGraph();

  var visitor = {
    CallExpression: function(path) {
      var callExpression = path.node;
      if (callExpression.callee.name !== 'enifed' ||
          callExpression.arguments.length !== 3 ||
          callExpression.arguments[0].type !== 'StringLiteral' ||
          callExpression.arguments[1].type !== 'ArrayExpression' ||
          callExpression.arguments[2].type !== 'FunctionExpression') {
        return;
      }
      var statementPath = path.parentPath;
      if (blockStatementPath === undefined) {
        blockStatementPath = statementPath.parentPath;
      } else {
        if (blockStatementPath !== statementPath.parentPath) {
          throw new Error('defines expected to be in the same block');
        }
      }
      if (first === -1) {
        first = statementPath.key;
      } else {
        if ((first+count) !== statementPath.key) {
          throw new Error('define statements expected to be contiguous '+(first+count)+' '+statementPath.key);
        }
      }

      count++;
      graph.add(callExpression);
    }
  };

  traverse(ast, visitor);

  graph.graph.setEdge('ember-metal/core',  'ember-metal/debug');

  if (relativePath === 'ember/ember.debug.js') {
    graph.graph.setEdge('ember-metal', 'ember-debug');
  }

  this.eagerLoad.forEach(graph.makeEager, graph);

  var lines = string.split(/\n/);
  function getLines(loc) {
    var start = loc.start.line-1;
    var end = loc.end.line;
    var src = lines.slice(start, end);
    if (loc.start.line === loc.end.line) {
      src[0] = src[0].slice(loc.start.column, loc.end.column);
    } else {
      src[0] = src[0].slice(loc.start.column);
      src[src.length-1] = src[src.length-1].slice(0, loc.end.column);
    }
    return src;
  }

  var buffer = [string.match(/\/\*![\s\S]+?\*\//)[0]];
  buffer.push('if (typeof Ember === \'undefined\') { Em = Ember = {}; }');
  buffer.push('Em.__global = this');
  buffer.push('Em._eager = ' + JSON.stringify(graph.eagerSet.names) + ';');
  buffer.push(fs.readFileSync(path.join(__dirname, '../templates/loader.js'), 'utf8'));

  function pushLines(lines) {
    for (var i = 0; i < lines.length; i++) {
      var line = lines[i];
      line = line.replace(/mainContext/g, 'Em.__global');
      line = line.replace(/\s(require|requireModule)\(/g, 'Em.__loader.require(');
      buffer.push(line);
    }
  }

  graph.set.names.forEach(function (name) {
    var module = graph.node(name);
    if (!graph.eagerSet.has(name)) {
      var src = getLines(module.functionExpression.loc);
      src[0] = 'Em.__loader._define(' + JSON.stringify(name) + ', ' + JSON.stringify(module.deps) + ', ' + src[0];
      src[src.length - 1] += ');';
      pushLines(src);
    }
  });
  graph.eagerSet.names.forEach(function (name) {
    var module = graph.node(name);
    var src = getLines(module.functionExpression.loc);
    src[0] = '('+ src[0];
    src[src.length - 1] += ')('+ module.deps.map(function (dep) {
      if (dep === 'require') {
        return 'Em.__loader.require';
      }
      var index = graph.eagerSet.map[dep === 'exports' ? name : dep];
      return 'Em._e['+index+']';
    }).join(',')+');';

    pushLines(src);
  });

  return buffer.join('\n');

};

module.exports = DefineRewriter;
