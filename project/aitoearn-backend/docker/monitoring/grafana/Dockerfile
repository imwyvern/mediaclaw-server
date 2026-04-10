FROM grafana/grafana:latest

COPY docker/monitoring/grafana/provisioning/datasources /etc/grafana/provisioning/datasources
COPY docker/monitoring/grafana/provisioning/dashboards /etc/grafana/provisioning/dashboards
COPY docker/monitoring/grafana/dashboards /etc/grafana/dashboards
COPY --chmod=755 docker/monitoring/grafana/run-grafana.sh /run-grafana.sh

ENTRYPOINT ["/bin/sh", "/run-grafana.sh"]
