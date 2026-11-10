// Runs before the page paints, so styles that depend on scripting (hidden
// until revealed, the pinned 3D stage) never flash their no-script look.
document.documentElement.classList.replace('no-js', 'js');
