fetch('assets/emma-v5.b64').then(r=>r.text()).then(t=>{
  window.testEmma='data:'+'image/jpeg'+';base64,'+t.trim();
});