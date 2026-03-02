#include <stdio.h>
#include "freertos/FreeRTOS.h"
#include "freertos/task.h"
#include "esp_log.h"
#include "audio_service.h"

static const char *TAG = "audio_service";

void audio_service_init(void)
{
    ESP_LOGI(TAG, "Audio Service Initialized");
    // TODO: Initialize I2S, ring buffers
}

void audio_i2s_task(void *arg)
{
    while (1) {
        vTaskDelay(pdMS_TO_TICKS(500));
    }
}