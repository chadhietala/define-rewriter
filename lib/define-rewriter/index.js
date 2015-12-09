var Rewriter = require('./src');

/*jshint node:true*/
module.exports = {
  name: 'ember-post-processor',
  treeForVendor: function(tree) {
    return new Rewriter(tree);
  },
  // postprocessTree: function(type, tree) {
  //   if (type === 'all') {
  //     return new Rewriter(tree);
  //   }
    
  //   return tree;
  // },
  isDevelopingAddon: function() {
    return true;
  }
};