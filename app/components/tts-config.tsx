import { TTSConfig, TTSConfigValidator } from "../store";
import { useProviderStore } from "../store/provider";

import Locale from "../locales";
import { ListItem, Select } from "./ui-lib";
import {
  DEFAULT_TTS_ENGINE,
  DEFAULT_TTS_ENGINES,
  DEFAULT_TTS_MODELS,
} from "../constant";
import { InputRange } from "./input-range";

export function TTSConfigList(props: {
  ttsConfig: TTSConfig;
  updateConfig: (updater: (config: TTSConfig) => void) => void;
}) {
  const providerStore = useProviderStore();
  const enabledProviders = providerStore.providers.filter((p) => p.enabled);

  return (
    <>
      <ListItem
        title={Locale.Settings.TTS.Enable.Title}
        subTitle={Locale.Settings.TTS.Enable.SubTitle}
      >
        <input
          type="checkbox"
          checked={props.ttsConfig.enable}
          onChange={(e) =>
            props.updateConfig(
              (config) => (config.enable = e.currentTarget.checked),
            )
          }
        ></input>
      </ListItem>
      {/* <ListItem
        title={Locale.Settings.TTS.Autoplay.Title}
        subTitle={Locale.Settings.TTS.Autoplay.SubTitle}
      >
        <input
          type="checkbox"
          checked={props.ttsConfig.autoplay}
          onChange={(e) =>
            props.updateConfig(
              (config) => (config.autoplay = e.currentTarget.checked),
            )
          }
        ></input>
      </ListItem> */}
      <ListItem title={Locale.Settings.TTS.Engine}>
        <Select
          value={props.ttsConfig.engine}
          onChange={(e) => {
            props.updateConfig(
              (config) =>
                (config.engine = TTSConfigValidator.engine(
                  e.currentTarget.value,
                )),
            );
          }}
        >
          {DEFAULT_TTS_ENGINES.map((v, i) => (
            <option value={v} key={i}>
              {v}
            </option>
          ))}
        </Select>
      </ListItem>

      {props.ttsConfig.engine === DEFAULT_TTS_ENGINE && (
        <ListItem title="语音供应商" subTitle="选择提供 TTS 接口的供应商">
          <Select
            value={props.ttsConfig.providerId}
            onChange={(e) => {
              props.updateConfig(
                (config) => (config.providerId = e.currentTarget.value),
              );
            }}
          >
            <option value="" key="default">
              自动选择（使用首个可用供应商）
            </option>
            {enabledProviders.map((v) => (
              <option value={v.id} key={v.id}>
                {v.label}
              </option>
            ))}
          </Select>
        </ListItem>
      )}

      {props.ttsConfig.engine === DEFAULT_TTS_ENGINE && (
        <>
          <ListItem title={Locale.Settings.TTS.Model}>
            <Select
              value={props.ttsConfig.model}
              onChange={(e) => {
                props.updateConfig(
                  (config) =>
                    (config.model = TTSConfigValidator.model(
                      e.currentTarget.value,
                    )),
                );
              }}
            >
              {DEFAULT_TTS_MODELS.map((v, i) => (
                <option value={v} key={i}>
                  {v}
                </option>
              ))}
            </Select>
          </ListItem>
          <ListItem
            title={Locale.Settings.TTS.Speed.Title}
            subTitle={Locale.Settings.TTS.Speed.SubTitle}
          >
            <InputRange
              aria={Locale.Settings.TTS.Speed.Title}
              value={props.ttsConfig.speed?.toFixed(1)}
              min="0.3"
              max="4.0"
              step="0.1"
              onChange={(e) => {
                props.updateConfig(
                  (config) =>
                    (config.speed = TTSConfigValidator.speed(
                      e.currentTarget.valueAsNumber,
                    )),
                );
              }}
            ></InputRange>
          </ListItem>
        </>
      )}
    </>
  );
}
