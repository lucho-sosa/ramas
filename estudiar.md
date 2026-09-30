---
description: Levanta la web de chats ramificados con la sesión actual como raíz
allowed-tools: Bash(bash ~/ramas/launch.sh:*)
---

Ejecutá el lanzador de la web de ramas pasándole el ID de esta sesión:

!`bash ~/ramas/launch.sh ${CLAUDE_SESSION_ID}`

No hace falta nada más: el script arranca el backend si no está corriendo
y abre el navegador apuntando a esta sesión. Solo confirmá que se abrió bien.
