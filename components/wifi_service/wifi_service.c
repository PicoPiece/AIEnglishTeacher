#include <stdio.h>
#include "freertos/FreeRTOS.h"
#include "freertos/task.h"
#include "esp_log.h"
#include "wifi_service.h"

static const char *TAG = "wifi_service";

void wifi_service_init(void)
{
    ESP_LOGI(TAG, "WiFi Service Initialized");
    // TODO: Set up Wi-Fi, events, WebSocket client
}

void wifi_ws_task(void *arg)
{
    while (1) {
        vTaskDelay(pdMS_TO_TICKS(1000));
    }
}