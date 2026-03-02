#include <stdio.h>
#include "freertos/FreeRTOS.h"
#include "freertos/task.h"
#include "esp_log.h"
#include "ui_service.h"

static const char *TAG = "ui_service";

void ui_service_init(void)
{
    ESP_LOGI(TAG, "UI Service Initialized");
    // TODO: LVGL setup, display driver
}

void ui_lvgl_task(void *arg)
{
    while (1) {
        vTaskDelay(pdMS_TO_TICKS(30));
    }
}