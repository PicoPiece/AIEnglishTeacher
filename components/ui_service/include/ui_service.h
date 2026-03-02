#ifndef UI_SERVICE_H
#define UI_SERVICE_H

#ifdef __cplusplus
extern "C" {
#endif

void ui_service_init(void);
void ui_lvgl_task(void *arg);

#ifdef __cplusplus
}
#endif

#endif // UI_SERVICE_H