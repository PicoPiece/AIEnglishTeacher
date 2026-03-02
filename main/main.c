#include <stdio.h>
#include "freertos/FreeRTOS.h"
#include "freertos/task.h"
#include "esp_log.h"

#include "board_support.h"
#include "wifi_service.h"
#include "audio_service.h"
#include "ui_service.h"

static const char *TAG = "main";

void app_main(void)
{
    board_support_init();

    wifi_service_init();
    audio_service_init();
    ui_service_init();

    xTaskCreate(wifi_ws_task, "wifi_ws", 8192, NULL, 5, NULL);
    xTaskCreate(audio_i2s_task, "audio_i2s", 16384, NULL, 15, NULL);
    xTaskCreate(ui_lvgl_task, "ui_lvgl", 16384, NULL, 4, NULL);

    ESP_LOGI(TAG, "System initialized, all tasks started.");
}
