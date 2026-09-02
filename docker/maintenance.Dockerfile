# MarkMySteps maintenance page — a static "back in a minute" screen.
#
# Deliberately has no build step and nothing in common with the app: it has to
# come up in a second, on a server where the real images may not exist yet.
FROM nginx:1.27-alpine
COPY docker/maintenance.conf /etc/nginx/conf.d/default.conf
COPY docker/maintenance/maintenance.html /usr/share/nginx/html/maintenance.html
COPY apps/web/public/favicon.svg /usr/share/nginx/html/favicon.svg
EXPOSE 80
