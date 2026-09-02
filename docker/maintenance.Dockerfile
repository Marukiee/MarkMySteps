# MarkMySteps maintenance page — a static "back in a minute" screen.
#
# Deliberately has no build step and nothing in common with the app: it has to
# come up in a second, on a server where the real images may not exist yet.
FROM nginx:1.27-alpine
COPY docker/maintenance.conf /etc/nginx/conf.d/default.conf
COPY docker/maintenance/maintenance.html /usr/share/nginx/html/maintenance.html
# The app's own two typefaces, so the page is in the app's own voice without
# asking a font CDN for anything while the rest of the stack is down.
COPY docker/maintenance/fraunces.woff2 /usr/share/nginx/html/fraunces.woff2
COPY docker/maintenance/inter.woff2 /usr/share/nginx/html/inter.woff2
COPY apps/web/public/favicon.svg /usr/share/nginx/html/favicon.svg
EXPOSE 80
