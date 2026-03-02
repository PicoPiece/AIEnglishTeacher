#ifndef AUDIO_SERVICE_H
#define AUDIO_SERVICE_H

#ifdef __cplusplus
extern "C" {
#endif

void audio_service_init(void);
void audio_i2s_task(void *arg);

#ifdef __cplusplus
}
#endif

#endif // AUDIO_SERVICE_H