/* Pure grid-coordinate sight geometry, shared by rendering and interaction. */
(function(root,factory){const api=factory();if(typeof module==='object'&&module.exports)module.exports=api;else root.VisionGeometry=api;})(typeof globalThis!=='undefined'?globalThis:this,()=>{
 const EPS=1e-8;
 const cross=(ax,ay,bx,by)=>ax*by-ay*bx;
 function rayHit(x,y,dx,dy,w){
  const sx=w.x2-w.x1,sy=w.y2-w.y1,qx=w.x1-x,qy=w.y1-y,den=cross(dx,dy,sx,sy);
  if(Math.abs(den)<EPS){if(Math.abs(cross(qx,qy,dx,dy))>EPS)return Infinity;const a=qx*dx+qy*dy,b=(w.x2-x)*dx+(w.y2-y)*dy;if(Math.max(a,b)<-EPS)return Infinity;return Math.max(0,Math.min(a,b));}
  const t=cross(qx,qy,sx,sy)/den,u=cross(qx,qy,dx,dy)/den;
  return t>=-EPS&&u>=-EPS&&u<=1+EPS?Math.max(0,t):Infinity;
 }
 const blockers=walls=>walls.filter(w=>w.kind!=='door'||!w.open);
 function canSee(source,target,walls,range=Infinity){
  const dx=target.x-source.x,dy=target.y-source.y,d=Math.hypot(dx,dy);
  if(d>range+EPS)return false;if(d<EPS)return true;
  for(const w of walls)if((w.kind!=='door'||!w.open)&&rayHit(source.x,source.y,dx/d,dy/d,w)<d-EPS)return false;
  return true;
 }
 function polygon(source,walls,width,height,range){
  // Segments entirely beyond the sight radius cannot intersect any cast ray.
  const nearby=blockers(walls).filter(w=>{const dx=w.x2-w.x1,dy=w.y2-w.y1,t=Math.max(0,Math.min(1,((source.x-w.x1)*dx+(source.y-w.y1)*dy)/(dx*dx+dy*dy)));return (w.x1+t*dx-source.x)**2+(w.y1+t*dy-source.y)**2<=range*range;});
  const edges=[...nearby,{x1:0,y1:0,x2:width,y2:0},{x1:width,y1:0,x2:width,y2:height},{x1:width,y1:height,x2:0,y2:height},{x1:0,y1:height,x2:0,y2:0}];
  const angles=[];for(let i=0;i<128;i++)angles.push(i*Math.PI*2/128);
  for(const w of edges)for(const p of [{x:w.x1,y:w.y1},{x:w.x2,y:w.y2}]){const a=Math.atan2(p.y-source.y,p.x-source.x);angles.push(a-1e-7,a,a+1e-7);}
  for(let i=0;i<angles.length;i++)angles[i]=((angles[i]%(2*Math.PI))+2*Math.PI)%(2*Math.PI);
  angles.sort((a,b)=>a-b);
  return angles.map(a=>{const dx=Math.cos(a),dy=Math.sin(a);let distance=range;for(const w of edges)distance=Math.min(distance,rayHit(source.x,source.y,dx,dy,w));return {x:source.x+dx*distance,y:source.y+dy*distance};});
 }
 const inRect=(p,r)=>p.x>=r.x&&p.y>=r.y&&p.x<=r.x+r.width&&p.y<=r.y+r.height;
 return {rayHit,canSee,polygon,inRect};
});
