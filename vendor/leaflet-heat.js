// vendored from leaflet.heat@0.2.0 — PATCHED, do not overwrite with a fresh copy:
//  1. getContext(willReadFrequently) on 3 calls (getImageData readback warning)
//  2. simpleheat shadow trick offset 200 -> 1e4, so radius+blur > 200 stops drawing the
//     source arc back onto the canvas as a hard-edged (corner-clipped) circle
//  3. canvas padded by 20% of the viewport so dragging does not pull blank canvas in
/*
 (c) 2014, Vladimir Agafonkin
 simpleheat, a tiny JavaScript library for drawing heatmaps with Canvas
 https://github.com/mourner/simpleheat
*/
!function(){"use strict";function t(i){return this instanceof t?(this._canvas=i="string"==typeof i?document.getElementById(i):i,this._ctx=i.getContext("2d",{willReadFrequently:true}),this._width=i.width,this._height=i.height,this._max=1,void this.clear()):new t(i)}t.prototype={defaultRadius:25,defaultGradient:{.4:"blue",.6:"cyan",.7:"lime",.8:"yellow",1:"red"},data:function(t,i){return this._data=t,this},max:function(t){return this._max=t,this},add:function(t){return this._data.push(t),this},clear:function(){return this._data=[],this},radius:function(t,i){i=i||15;var a=this._circle=document.createElement("canvas"),s=a.getContext("2d",{willReadFrequently:true}),e=this._r=t+i;return a.width=a.height=2*e,s.shadowOffsetX=s.shadowOffsetY=1e4,s.shadowBlur=i,s.shadowColor="black",s.beginPath(),s.arc(e-1e4,e-1e4,t,0,2*Math.PI,!0),s.closePath(),s.fill(),this},gradient:function(t){var i=document.createElement("canvas"),a=i.getContext("2d",{willReadFrequently:true}),s=a.createLinearGradient(0,0,0,256);i.width=1,i.height=256;for(var e in t)s.addColorStop(e,t[e]);return a.fillStyle=s,a.fillRect(0,0,1,256),this._grad=a.getImageData(0,0,1,256).data,this},draw:function(t){this._circle||this.radius(this.defaultRadius),this._grad||this.gradient(this.defaultGradient);var i=this._ctx;i.clearRect(0,0,this._width,this._height);for(var a,s=0,e=this._data.length;e>s;s++)a=this._data[s],i.globalAlpha=Math.max(a[2]/this._max,t||.05),i.drawImage(this._circle,a[0]-this._r,a[1]-this._r);var n=i.getImageData(0,0,this._width,this._height);return this._colorize(n.data,this._grad),i.putImageData(n,0,0),this},_colorize:function(t,i){for(var a,s=3,e=t.length;e>s;s+=4)a=4*t[s],a&&(t[s-3]=i[a],t[s-2]=i[a+1],t[s-1]=i[a+2])}},window.simpleheat=t}(),/*
 (c) 2014, Vladimir Agafonkin
 Leaflet.heat, a tiny and fast heatmap plugin for Leaflet.
 https://github.com/Leaflet/Leaflet.heat
*/
L.HeatLayer=(L.Layer?L.Layer:L.Class).extend({initialize:function(t,i){this._latlngs=t,L.setOptions(this,i)},setLatLngs:function(t){return this._latlngs=t,this.redraw()},addLatLng:function(t){return this._latlngs.push(t),this.redraw()},setOptions:function(t){return L.setOptions(this,t),this._heat&&this._updateOptions(),this.redraw()},redraw:function(){return!this._heat||this._frame||this._map._animating||(this._frame=L.Util.requestAnimFrame(this._redraw,this)),this},onAdd:function(t){this._map=t,this._canvas||this._initCanvas(),t._panes.overlayPane.appendChild(this._canvas),t.on("moveend",this._reset,this),t.options.zoomAnimation&&L.Browser.any3d&&t.on("zoomanim",this._animateZoom,this),this._reset()},onRemove:function(t){t.getPanes().overlayPane.removeChild(this._canvas),t.off("moveend",this._reset,this),t.options.zoomAnimation&&t.off("zoomanim",this._animateZoom,this)},addTo:function(t){return t.addLayer(this),this},_initCanvas:function(){var t=this._canvas=L.DomUtil.create("canvas","leaflet-heatmap-layer leaflet-layer"),i=L.DomUtil.testProp(["transformOrigin","WebkitTransformOrigin","msTransformOrigin"]);t.style[i]="50% 50%";var a=this._map.getSize();t.width=a.x,t.height=a.y;var s=this._map.options.zoomAnimation&&L.Browser.any3d;L.DomUtil.addClass(t,"leaflet-zoom-"+(s?"animated":"hide")),this._heat=simpleheat(t),this._updateOptions()},_updateOptions:function(){this._heat.radius(this.options.radius||this._heat.defaultRadius,this.options.blur),this.options.gradient&&this._heat.gradient(this.options.gradient),this.options.max&&this._heat.max(this.options.max)},_reset:function(){var t=this._map.containerPointToLayerPoint([0,0]);L.DomUtil.setPosition(this._canvas,t);var i=this._map.getSize();this._heat._width!==i.x&&(this._canvas.width=this._heat._width=i.x),this._heat._height!==i.y&&(this._canvas.height=this._heat._height=i.y),this._redraw()},_redraw:function(){var t,i,a,s,e,n,h,o,r,d=[],_=this._heat._r,l=this._map.getSize(),m=new L.Bounds(L.point([-_,-_]),l.add([_,_])),c=void 0===this.options.max?1:this.options.max,u=void 0===this.options.maxZoom?this._map.getMaxZoom():this.options.maxZoom,f=1/Math.pow(2,Math.max(0,Math.min(u-this._map.getZoom(),12))),g=_/2,p=[],v=this._map._getMapPanePos(),w=v.x%g,y=v.y%g;for(t=0,i=this._latlngs.length;i>t;t++)if(a=this._map.latLngToContainerPoint(this._latlngs[t]),m.contains(a)){e=Math.floor((a.x-w)/g)+2,n=Math.floor((a.y-y)/g)+2;var x=void 0!==this._latlngs[t].alt?this._latlngs[t].alt:void 0!==this._latlngs[t][2]?+this._latlngs[t][2]:1;r=x*f,p[n]=p[n]||[],s=p[n][e],s?(s[0]=(s[0]*s[2]+a.x*r)/(s[2]+r),s[1]=(s[1]*s[2]+a.y*r)/(s[2]+r),s[2]+=r):p[n][e]=[a.x,a.y,r]}for(t=0,i=p.length;i>t;t++)if(p[t])for(h=0,o=p[t].length;o>h;h++)s=p[t][h],s&&d.push([Math.round(s[0]),Math.round(s[1]),Math.min(s[2],c)]);this._heat.data(d).draw(this.options.minOpacity),this._frame=null},_animateZoom:function(t){var i=this._map.getZoomScale(t.zoom),a=this._map._getCenterOffset(t.center)._multiplyBy(-i).subtract(this._map._getMapPanePos());L.DomUtil.setTransform?L.DomUtil.setTransform(this._canvas,a,i):this._canvas.style[L.DomUtil.TRANSFORM]=L.DomUtil.getTranslateString(a)+" scale("+i+")"}}),L.heatLayer=function(t,i){return new L.HeatLayer(t,i)};

// PATCH 3: the stock layer sizes its canvas to the viewport and only repaints on `moveend`, so a
// pan drags blank canvas in from the edge until you let go — the heatmap looks cut off mid-drag.
// Draw into a canvas padded by HEAT_PAD of the viewport on every side instead: the margin is
// already painted when it slides into view. Repaint cost is per canvas pixel (getImageData +
// a per-pixel colorize loop), so padding costs (1+2*PAD)^2 — hence 0.2, not 1.
// Logic below is the original _reset/_redraw, de-minified, with the pad offset threaded through.
L.HeatLayer.include({
  _pad() { return this._map.getSize().multiplyBy(0.2)._round(); },

  _reset() {
    const pad = this._pad(), size = this._map.getSize().add(pad.multiplyBy(2));
    L.DomUtil.setPosition(this._canvas, this._map.containerPointToLayerPoint([-pad.x, -pad.y]));
    if (this._heat._width !== size.x) this._canvas.width = this._heat._width = size.x;
    if (this._heat._height !== size.y) this._canvas.height = this._heat._height = size.y;
    this._redraw();
  },

  _redraw() {
    if (!this._map) return;
    const pad = this._pad(), r = this._heat._r, cell = r / 2, size = this._map.getSize();
    // A point up to one radius outside the padded canvas still bleeds into it.
    const bounds = new L.Bounds(L.point([-r, -r])._subtract(pad), size.add(pad).add([r, r]));
    const max = this.options.max === undefined ? 1 : this.options.max;
    const maxZoom = this.options.maxZoom === undefined ? this._map.getMaxZoom() : this.options.maxZoom;
    const weightScale = 1 / Math.pow(2, Math.max(0, Math.min(maxZoom - this._map.getZoom(), 12)));
    const panePos = this._map._getMapPanePos(), ox = panePos.x % cell, oy = panePos.y % cell;
    // Grid indices must stay >= 0 — a bare array skips negative keys, which would drop the blobs
    // in the top/left padding. Stock's +2 was enough only because it had no padding.
    const off = Math.ceil((Math.max(pad.x, pad.y) + r) / cell) + 2;
    const grid = [];
    for (const ll of this._latlngs) {
      const p = this._map.latLngToContainerPoint(ll);
      if (!bounds.contains(p)) continue;
      const x = Math.floor((p.x - ox) / cell) + off, y = Math.floor((p.y - oy) / cell) + off;
      const w = (ll.alt !== undefined ? ll.alt : ll[2] !== undefined ? +ll[2] : 1) * weightScale;
      const row = grid[y] || (grid[y] = []), c = row[x];
      if (c) {                                        // weighted mean of the cell's points
        c[0] = (c[0] * c[2] + p.x * w) / (c[2] + w);
        c[1] = (c[1] * c[2] + p.y * w) / (c[2] + w);
        c[2] += w;
      } else row[x] = [p.x, p.y, w];
    }
    const data = [];
    for (const row of grid) if (row) for (const c of row) if (c) {
      data.push([Math.round(c[0] + pad.x), Math.round(c[1] + pad.y), Math.min(c[2], max)]);
    }
    this._heat.data(data).draw(this.options.minOpacity);
    this._frame = null;
  },

  // The stock zoom animation writes an absolute transform, which throws away the padded position
  // set by _reset — the layer visibly detaches for the length of the animation and snaps back on
  // moveend. Its offset places element pixel 0 at container 0; ours holds container -pad there, so
  // shift by -pad. (transform-origin is 50% 50%, but the padded canvas shares the unpadded one's
  // centre, so the scale terms cancel and a plain subtraction is exact.)
  _animateZoom(e) {
    const scale = this._map.getZoomScale(e.zoom);
    const offset = this._map._getCenterOffset(e.center)._multiplyBy(-scale)
      ._subtract(this._map._getMapPanePos())._subtract(this._pad());
    if (L.DomUtil.setTransform) L.DomUtil.setTransform(this._canvas, offset, scale);
    else this._canvas.style[L.DomUtil.TRANSFORM] =
      L.DomUtil.getTranslateString(offset) + ' scale(' + scale + ')';
  },
});