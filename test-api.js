fetch("https://catiecli.sukaka.top/v1/models", {
  headers: {
    "Authorization": "Bearer cat-ab13e12539efd3f6ac915fda00452303c1500ccf86e94428"
  }
}).then(res => res.text()).then(console.log).catch(console.error);
