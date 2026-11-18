/* Se ejecuta antes de arrancar (ver render.yaml): si no hay base de datos, intenta recuperar el último respaldo externo. */
require('./backup').restoreIfMissing().then(
  (r) => { console.log('Restauración:', r); },
  (e) => { console.error('Restauración falló:', e.message); process.exitCode = 1; }
);
