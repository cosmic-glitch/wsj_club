/* Tap-a-word glossary for the served article pages.
   Loads /glossaries/<page>.json (derived from location.pathname:
   /articles/2026-07-23.html -> /glossaries/2026-07-23.json,
   /articles/junior/2026-07-15.html -> /glossaries/junior/2026-07-15.json).
   No JSON for the page -> silent no-op, the article renders untouched.

   Entry shape: { k, t, kind, pron?, forms[], text, audio? }
   kind: "vocab" (the day's handout word, yellow) | "word" | "phrase" | "name".
   audio: true when a pronunciation clip exists at
   /audio/<date>/gloss/<k>.mp3 (junior keeps its junior/ segment; multi-article
   pages share the date's dir) — written by scripts/gen-glossary-audio.mjs.
   The sheet then shows a speaker button next to the term; no flag, no button.
   The first occurrence of each entry gets a dotted mark (vocab: yellow
   highlight); EVERY occurrence is tappable via caret hit-testing; a tap
   on a word with no entry does nothing. Kept ES5-ish for older
   iOS WebKit. */
(function(){
"use strict";

var m=location.pathname.match(/^\/articles\/(.+)\.html$/);
if(!m)return;
// Pronunciation clips live under the DATE (multi-article -1/-2 pages share it).
var AUDIO_BASE="/audio/"+m[1].replace(/^((?:junior\/)?\d{4}-\d{2}-\d{2}).*$/,"$1")+"/gloss/";
fetch("/glossaries/"+m[1]+".json").then(function(r){
  if(!r.ok)throw new Error("no glossary");
  return r.json();
}).then(function(glossary){
  if(Array.isArray(glossary)&&glossary.length)init(glossary);
}).catch(function(){/* no glossary for this page */});

function init(GLOSSARY){
var byKey={},aliasMap={},phraseForms=[];
GLOSSARY.forEach(function(e){
  byKey[e.k]=e;
  e.forms.forEach(function(f){
    var lf=f.toLowerCase();
    if(!(lf in aliasMap))aliasMap[lf]=e.k;
    if(f.indexOf(" ")>=0)phraseForms.push({form:lf,k:e.k});
  });
});

function escRe(s){return s.replace(/[.*+?^${}()|[\]\\]/g,"\\$&");}
function formRe(f){return new RegExp("(^|[^A-Za-z\\u00C0-\\u024F-])("+escRe(f)+")(?![A-Za-z\\u00C0-\\u024F-])","i");}

/* ---- mark first occurrence of each entry ---- */
function markAll(){
  var main=document.querySelector("main");if(!main)return;
  var containers=[].slice.call(main.querySelectorAll("h1, p"));
  // longest-first so phrases win over contained words
  var entries=GLOSSARY.slice().sort(function(a,b){return b.forms[0].length-a.forms[0].length;});
  entries.forEach(function(e){
    var marked=false;
    for(var ci=0;ci<containers.length&&!marked;ci++){
      var walker=document.createTreeWalker(containers[ci],NodeFilter.SHOW_TEXT,{acceptNode:function(n){
        return n.parentElement&&n.parentElement.closest(".gw,script,style,a")?NodeFilter.FILTER_REJECT:NodeFilter.FILTER_ACCEPT;}});
      var node;
      while(!marked&&(node=walker.nextNode())){
        for(var fi=0;fi<e.forms.length&&!marked;fi++){
          var mm=formRe(e.forms[fi]).exec(node.textContent);
          if(mm){
            var start=mm.index+mm[1].length,len=mm[2].length;
            var target=node.splitText(start);target.splitText(len);
            var span=document.createElement("span");
            span.className="gw"+(e.kind==="vocab"?" gw--vocab":"");
            span.setAttribute("data-k",e.k);
            span.setAttribute("role","button");
            span.setAttribute("tabindex","0");
            target.parentNode.replaceChild(span,target);
            span.appendChild(target);
            marked=true;
          }
        }
      }
    }
  });
}

/* ---- bottom sheet ---- */
var backdrop,sheet,lastFocus=null;
function buildUi(){
  backdrop=document.createElement("div");backdrop.id="gsBackdrop";backdrop.style.display="none";
  sheet=document.createElement("div");sheet.id="gsSheet";sheet.style.display="none";
  sheet.setAttribute("role","dialog");sheet.setAttribute("aria-modal","true");
  document.body.appendChild(backdrop);document.body.appendChild(sheet);
  backdrop.addEventListener("click",closeSheet);
  document.addEventListener("keydown",function(ev){if(ev.key==="Escape")closeSheet();});
}
function chipFor(e){
  if(e.kind==="vocab")return'<span class="gs-chip gs-chip--vocab">Today’s vocab</span>';
  if(e.kind==="phrase")return'<span class="gs-chip">Phrase</span>';
  if(e.kind==="name")return'<span class="gs-chip">Name</span>';
  return'<span class="gs-chip">Word</span>';
}
function esc(s){return String(s).replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;");}
/* the handout PronounceButton's speaker glyph */
var SPEAKER_SVG='<svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">'+
  '<path d="M11 5 6 9H3v6h3l5 4V5z"></path>'+
  '<path d="M15.5 8.5a4 4 0 0 1 0 7M18 6a7 7 0 0 1 0 12" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"></path></svg>';
var hearAudio=null;
function stopHear(){
  if(hearAudio){try{hearAudio.pause();}catch(err){}hearAudio=null;}
  var b=sheet&&sheet.querySelector(".gs-hear.on");
  if(b)b.classList.remove("on");
}
function openSheet(k){
  var e=byKey[k];if(!e)return;
  stopHear();
  var h=chipFor(e);
  // The pron + speaker button ride in a no-wrap span with the term's LAST word,
  // so a wrapping phrase never strands the button alone on the next line.
  var words=esc(e.t).split(" "),lastWord=words.pop();
  h+='<div class="gs-term">'+(words.length?words.join(" ")+" ":"")+
    '<span class="gs-tail">'+lastWord+(e.pron?'<span class="gs-pron">'+esc(e.pron)+"</span>":"")+
    (e.audio?'<button class="gs-hear" title="Hear it" aria-label="Hear &quot;'+esc(e.t)+'&quot; pronounced">'+SPEAKER_SVG+"</button>":"")+"</span></div>";
  String(e.text).split("\n\n").forEach(function(para){
    h+='<p class="gs-text">'+esc(para)+"</p>";
  });
  sheet.innerHTML='<div class="gs-inner"><button class="gs-x" aria-label="Close">✕</button>'+h+"</div>";
  sheet.querySelector(".gs-x").addEventListener("click",closeSheet);
  var hb=sheet.querySelector(".gs-hear");
  if(hb)hb.addEventListener("click",function(){
    stopHear();
    var a=new Audio(AUDIO_BASE+e.k+".mp3");
    hearAudio=a;
    hb.classList.add("on");
    a.onended=a.onerror=function(){hb.classList.remove("on");if(hearAudio===a)hearAudio=null;};
    a.play().catch(function(){hb.classList.remove("on");if(hearAudio===a)hearAudio=null;});
  });
  lastFocus=document.activeElement;
  backdrop.style.display="block";sheet.style.display="block";
  document.body.style.overflow="hidden";
  requestAnimationFrame(function(){backdrop.classList.add("on");sheet.classList.add("on");});
  sheet.querySelector(".gs-x").focus({preventScroll:true});
}
function closeSheet(){
  if(sheet.style.display==="none")return;
  stopHear();
  backdrop.classList.remove("on");sheet.classList.remove("on");
  document.body.style.overflow="";
  setTimeout(function(){backdrop.style.display="none";sheet.style.display="none";},200);
  if(lastFocus&&lastFocus.focus)lastFocus.focus({preventScroll:true});
}
/* ---- tap anywhere: caret -> word -> entry ---- */
function caretFromPoint(x,y){
  if(document.caretRangeFromPoint){var r=document.caretRangeFromPoint(x,y);
    return r?{node:r.startContainer,offset:r.startOffset}:null;}
  if(document.caretPositionFromPoint){var p=document.caretPositionFromPoint(x,y);
    return p?{node:p.offsetNode,offset:p.offset}:null;}
  return null;
}
var WORD_CH=/[A-Za-zÀ-ɏ-]/;
function wordAt(text,idx){
  if(idx>0&&!WORD_CH.test(text.charAt(idx)))idx--;
  if(!WORD_CH.test(text.charAt(idx)))return null;
  var s=idx,e2=idx;
  while(s>0&&WORD_CH.test(text.charAt(s-1)))s--;
  while(e2<text.length-1&&WORD_CH.test(text.charAt(e2+1)))e2++;
  return{word:text.slice(s,e2+1),start:s,end:e2+1};
}
function handleTap(ev){
  var gw=ev.target.closest&&ev.target.closest(".gw");
  if(gw){openSheet(gw.getAttribute("data-k"));return;}
  if(ev.target.closest&&(ev.target.closest("a,button,figure,.top,#gsSheet,#gsBackdrop")))return;
  var c=caretFromPoint(ev.clientX,ev.clientY);
  if(!c||!c.node||c.node.nodeType!==3)return;
  var host=c.node.parentElement;
  if(!host||!host.closest("main"))return;
  var block=host.closest("p,h1");if(!block)return;
  var text=c.node.textContent;
  var w=wordAt(text,Math.min(c.offset,Math.max(0,text.length-1)));
  if(!w)return;
  // phrase check within this text node
  for(var i=0;i<phraseForms.length;i++){
    var re=new RegExp("(^|[^A-Za-z\\u00C0-\\u024F-])("+escRe(phraseForms[i].form)+")(?![A-Za-z\\u00C0-\\u024F-])","ig");
    var mm;
    while((mm=re.exec(text))){
      var ps=mm.index+mm[1].length,pe=ps+mm[2].length;
      if(w.start>=ps&&w.end<=pe){openSheet(phraseForms[i].k);return;}
    }
  }
  var key=aliasMap[w.word.toLowerCase()];
  if(key)openSheet(key);
}

markAll();buildUi();
document.addEventListener("click",handleTap);
document.addEventListener("keydown",function(ev){
  if((ev.key==="Enter"||ev.key===" ")&&ev.target.classList&&ev.target.classList.contains("gw")){
    ev.preventDefault();openSheet(ev.target.getAttribute("data-k"));
  }
});
}
})();
