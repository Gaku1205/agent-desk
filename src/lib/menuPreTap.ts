/**
 * ハイドレーション前のメニュー（ハンバーガー）のタップ。
 * ページの中身が届き終わるまで JS が動かず、React のクリック処理がまだ付いていないので、
 * 最初に読む小さなスクリプトが、押されたら DOM を直接開閉する。React が動き出したら（ボタンに `__reactProps$` が付く）何もしない。
 * 開いたままハイドレーションが終わったら、`useMenuState` が `window.__menuPreOpen` を見て開いた状態を引き継ぐ。
 */
export const MENU_PRE_TAP_SCRIPT = `(function(){
function set(open){
var s=document.getElementById("menu-sheet");
if(!s)return;
window.__menuPreOpen=open;
if(open){s.setAttribute("data-open","");s.removeAttribute("inert");s.setAttribute("aria-hidden","false")}
else{s.removeAttribute("data-open");s.setAttribute("inert","");s.setAttribute("aria-hidden","true")}
var b=document.querySelector("[aria-controls=menu-sheet]");
if(b)b.setAttribute("aria-expanded",open?"true":"false");
document.body.style.overflow=open?"hidden":"";
}
document.addEventListener("click",function(e){
var t=e.target;
if(!t||!t.closest)return;
var b=t.closest("[aria-controls=menu-sheet]");
if(b){
if(Object.keys(b).some(function(k){return k.indexOf("__reactProps$")===0}))return;
set(!window.__menuPreOpen);
return;
}
var s=document.getElementById("menu-sheet");
if(window.__menuPreOpen&&s&&s.firstElementChild===t)set(false);
},true);
})();`;

declare global {
  interface Window {
    /** ハイドレーション前にメニューが押されて開いている（`MENU_PRE_TAP_SCRIPT` が立てる） */
    __menuPreOpen?: boolean;
  }
}
