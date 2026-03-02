#ifndef WIFI_SERVICE_H
#define WIFI_SERVICE_H

#ifdef __cplusplus
extern "C" {
#endif

void wifi_service_init(void);
void wifi_ws_task(void *arg);

#ifdef __cplusplus
}
#endif

#endif // WIFI_SERVICE_H