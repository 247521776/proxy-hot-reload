'use strict';

if (typeof Proxy !== 'function' && typeof Reflect !== 'object') {
  console.error('Error: your current Node.js not support Proxy or Reflect!');
  return;
}

if (process.env.NODE_ENV === 'production') {
  console.warn('Warning: proxy-hot-reload should not used in production environment!');
}

const Module = require('module');

const _ = require('lodash');
const glob = require('glob');
const shimmer = require('shimmer');
const chokidar = require('chokidar');
const debug = require('debug')('proxy-hot-reload');

const pkg = require('./package');
const globOpt = {
  nodir: true,
  absolute: true
}

module.exports = function proxyHotReload(opts) {
  opts = opts || {};
  const includes = glob.sync(opts.includes || '**/*.js', globOpt) || [];    
  const excludes = glob.sync(opts.excludes || '**/node_modules/**', globOpt) || [];
  const filenames = _.difference(includes, excludes);
  debug('Watch files: %j', filenames);

  chokidar
    .watch(filenames, {
      usePolling: true
    })
    .on('change', (path) => {
      try {
        //支持web服务热更新 以及多层级关系缓存处理
        clearCache(path);
      } catch (e) {
        console.error('proxy-hot-reload reload %s error:', path);
        console.error(e.stack);
      }
    })
    .on('error', (error) => console.error(error));


  shimmer.wrap(Module.prototype, '_compile', function (__compile) {
    return function proxyHotReloadCompile(content, filename) {
      if (!_.includes(filenames, filename)) {
        try {
          return __compile.call(this, content, filename);
        } catch(e) {
          console.error('proxy-hot-reload cannot compile file: %s', filename);
          console.error(e.stack);
          throw e;
        }
      } else {
        const result = __compile.call(this, content, filename);
        this._exports = this.exports;
        try {
          // try to wrap with Proxy
          this.exports =  new Proxy(this._exports, {
            get: function (target, key, receiver) {
              try {
                if (require.cache[filename]) {
                  debug('Get %s from require.cache[%s]', key, filename);
                  return require.cache[filename]._exports[key];
                } else {
                  debug('Get %s from original %s', key, filename);
                  return Reflect.get(target, key, receiver);
                }
              } catch (e) {
                console.error('proxy-hot-reload get %s from %s error:', key, filename);
                console.error(e.stack);
                throw e;
              }
            }
          });

        } catch (e) {
          console.error('proxy-hot-reload wrap %s with Proxy error:', filename);
          console.error(e.stack);
        }
        return result;
      }
    }
  });
};
function clearCache(path) {
  const cache = require.cache[path];
  if (cache) {
      cache.parent.children.splice(cache.parent.children.indexOf(cache), 1);
      const parent = cache.parent;
      const filename = parent.filename;
      delete require.cache[path];
      require(path);
      require.cache[path].parent = parent;
      if (parent && parent.id !== ".") {
          clearCache(parent.filename);
      }
      debug('Reload file: %s', path);
  }
}