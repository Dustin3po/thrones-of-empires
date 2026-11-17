# Publicar gratis en Render (unos 5 minutos)

1. Crea una cuenta en https://github.com y pulsa "New repository". Ponle de nombre thrones-of-empires y créalo (Public o Private).
2. En el repositorio nuevo pulsa "uploading an existing file" (o Add file > Upload files) y arrastra TODO el contenido de esta carpeta
   (server, public, package.json, render.yaml, .gitignore, README.md). Pulsa "Commit changes".
3. Crea una cuenta en https://render.com entrando con GitHub.
4. Pulsa New > Blueprint, elige el repositorio y confirma. Render leerá render.yaml y creará el servicio gratuito.
   (Alternativa manual: New > Web Service, Build Command "npm install", Start Command "npm start", plan Free.)
5. Espera a que termine el despliegue. Tu enlace será https://thrones-of-empires.onrender.com (o similar).

Notas:
- El plan gratuito se duerme tras 15 min sin visitas; la primera visita tarda en despertar.
- Las cuentas/ELO pueden borrarse al reiniciar el servicio (el disco gratuito no es permanente).
- Prueba el multijugador con dos pestañas antes de invitar a otras personas.
