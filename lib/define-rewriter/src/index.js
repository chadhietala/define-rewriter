var Filter = require('broccoli-persistent-filter');
var babel = require('babel-core');
var babylon = require('babylon');
var traverse = require('babel-traverse').default;
var t = require('babel-types');
var generate = require('babel-generator').default;
var graph = require('graphlib');
var DAG = graph.Graph;
var amdNameResolver = require('amd-name-resolver');

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

function DefineRewritter(inputNode, options) {
  this.dag = new DAG();
  Filter.call(this, inputNode, options);
  this.dag.setEdge('a', 'b', 'ddddd');
}

DefineRewritter.prototype = Object.create(Filter.prototype);
DefineRewritter.prototype.constructor = DefineRewritter;

DefineRewritter.prototype.processString = function(string, relativePath) {
  if (relativePath === 'assets/vendor.js') {
    var ast = babylon.parse(string);
    var dag = this.dag;
    var keys = [];
    var registryId;
    var registryPath;
    var defineStatementPaths = [];

    var visitor = {
      ObjectExpression: function(path, state) {
        if (path.parent.type === 'VariableDeclarator' &&
            path.parent.id.name === 'registry') {
          
          var hasEmberLoader = false;
          var ifStatementPath = path.parentPath.parentPath.parentPath.parentPath;
          
          ifStatementPath.traverse({
            MemberExpression: function(path, state) {
              if (path.node.object.name === 'Ember' && path.node.property.name === '__loader') {
                hasEmberLoader = true;
              }
            }
          });
          
          if (hasEmberLoader) {
            registryId = path.parent.id;
            registryPath = path;
          }
        }
      },
      CallExpression: function(path, state) {
        if (path.node.callee.name === 'enifed' && path.node.arguments.length === 3) {
          defineStatementPaths.push(path.parentPath);
          var moduleName = path.node.arguments[0].value;
          var parentParts = moduleName.split('/');
          var deps = path.node.arguments[1].elements.map(function(node) {
            return node.value;
          }).filter(function(dep) {
            return dep !== 'exports';
          });
          
          dag.setNode(moduleName, path);
          
          deps.forEach(function addEdge(dep) {
            var parts = dep.split('/');
            if (dep.indexOf('..') === 0 && parentParts.length === 1 && parts[1] !== parentParts[0]) {
              dep = dep.replace('../', '');
            }

            dag.setEdge(moduleName, amdNameResolver(dep, moduleName));
          });
        }
      }
    };
    
    traverse(ast, visitor);
    
    var blockStatementPath = defineStatementPaths[0].parentPath;
    var start = defineStatementPaths[0].key;
    var end = defineStatementPaths[defineStatementPaths.length - 1].key + 1;
    
    var head = blockStatementPath.node.body.slice(0, start)
    var tail = blockStatementPath.node.body.slice(end);
    var body = [];
    var registryProps = [];

    var postOrder = graph.alg.postorder(this.dag, 'ember');
    var orderedPaths = postOrder.map(function(node) {
      var path = dag.node(node);
      console.assert(path, 'path is truthy: '+node);
      return path;
    });

    defineStatementPaths.forEach(function(defineStatementPath) {
      var nameLiteral = defineStatementPath.node.expression.arguments[0];
      registryProps.push(
        t.objectProperty(nameLiteral, t.objectExpression([]))
      );
    });

    registryPath.replaceWith(t.objectExpression(registryProps));
    
    orderedPaths.forEach(function(path) {
      // moduleName
      var nameLiteral = path.node.arguments[0];
      // deps
      var arrayExpression = path.node.arguments[1];
      // function
      var funcExpression = path.node.arguments[2];
    
      var args = arrayExpression.elements.map(function(literal) {
        if (literal.value === 'exports') {
          return t.memberExpression(
            registryId,
            nameLiteral,
            true
          );
        }
        return t.memberExpression(
          registryId,
          literal,
          true
        );
      });
    
      body.push(
        t.expressionStatement(
          t.callExpression(funcExpression, args)
        )
      );
    }, this);
    
    var newBlockStatement = t.blockStatement(head.concat(body, tail));
    blockStatementPath.replaceWith(newBlockStatement);

    return generate(ast, null, string).code;
  }
  
  return string;
};

module.exports = DefineRewritter;