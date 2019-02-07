require("@babel/polyfill")
require("./mdx-override") // convert mdx to jsx on import()
const babelConfig = require("./babel.config")
require('@babel/register')(babelConfig)
require('ignore-styles') // ignore css/scss imports on server side.

const debug = require('debug')('react')
const fs = require('fs')
const path = require('path')
const mkdirp = require('mkdirp')
const React = require('react')
const {
  renderToString
} = require('react-dom/server')

// we use client's helmet instance to avoid two Helmet instances to be loaded.
// see: https://github.com/nfl/react-helmet/issues/125
// and https://stackoverflow.com/questions/45822925/react-helmet-outputting-empty-strings-on-server-side
const {Helmet} = require( require('path').join(process.env.BUILDPATH, "/node_modules/react-helmet") )

const jsonStringify = require('json-stringify-safe')
const bundle = require('./bundle')

var bundleInfo = false

async function generateComponent(req, res, componentPath, bundlePath){
  var fullBundlePath = path.join(process.env.BUILDPATH, bundlePath)
  try{
  var App = require(componentPath)
  }
  catch(e){
    console.log(e)
  }
  var meta = App.meta || {}
  App = (App && App.default)?App.default : App // cater export default class...
  var props = {user: req.user, url: {query: req.query, params: req.params}}
  debug("App", typeof App.getInitialProps === "function")
  if (App && App.getInitialProps && typeof App.getInitialProps === "function"){
    try{
      var newProps = await App.getInitialProps({req, ...props}) || {}
      props = {...props, ...newProps}
    }
    catch(e){
      debug("ERROR::getInitialProps", e)
    }
  }
  
  if (!bundleInfo){
    if (!fs.existsSync(fullBundlePath)){
      mkdirp.sync(fullBundlePath)
      const stats = await bundle(componentPath, fullBundlePath)
      // var bundleFiles = await bundle(componentPath, fullBundlePath)
      // debug("bundle size", bundleFiles.js.length/1024)
      
      // if (bundleFiles.js) fs.writeFileSync(path.join(fullBundlePath,"/bundle.js"), bundleFiles.js, 'utf8')
      // if (bundleFiles.css) fs.writeFileSync(path.join(fullBundlePath,"/bundle.css"), bundleFiles.css, 'utf8')
    }

    bundleInfo = {
      js: fs.existsSync( path.join(fullBundlePath,"/bundle.js") ) ? path.join(bundlePath, "/bundle.js") : false,
      css: fs.existsSync( path.join(fullBundlePath,"/bundle.css") ) ? path.join(bundlePath, "/bundle.css") : false,
    }
  }

  const el = isAsync(App)
    ? await createAsyncElement(App, props)
    : React.createElement(App, props)

  const html = renderToString(el)
  const helmet = Helmet.renderStatic()

  // determine if the user has provided with <meta charset />, 
  // if not, add a default tag with utf8
  var hasCharset = helmet.meta.toComponent().find((meta)=>{
    return meta.props && (meta.props['charSet'] || meta.props['charset'])
  })
  const json = jsonStringify(props)
  const finalMetaTags = {
    title: (helmet.title.toComponent()[0].props.children.length>0)? helmet.title.toString() : (meta.title?`<title>${meta.title}</title>`:"")
  }
  var markup = `<!DOCTYPE html>
  <html ${helmet.htmlAttributes.toString()}>
    <head>
      ${(!hasCharset?'<meta charset="utf-8"/>':'')}
      ${finalMetaTags.title}
      ${helmet.meta.toString()}
      ${helmet.link.toString()}
      ${(bundleInfo.css?`<link rel="stylesheet" href="/${bundleInfo.css}">`:"")}
    </head>
    <body ${helmet.bodyAttributes.toString()}>
      <div id="_react_root">${html}</div>
      <script id='initial_props' type='application/json'>${json}</script>
      <script src="/${bundleInfo.js}"></script>
    </body>
  </html>`

  res.write(markup)
  res.end()
}


const isAsync = fn => fn.constructor.name === 'AsyncFunction'

const createAsyncElement = async (Component, props) =>
  await Component(props)

module.exports = generateComponent