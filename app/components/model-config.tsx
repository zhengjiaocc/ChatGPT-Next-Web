import { ServiceProvider } from "@/app/constant";
import { ModalConfigValidator, ModelConfig } from "../store";
import { useState } from "react";
import Locale from "../locales";
import { InputRange } from "./input-range";
import { ListItem } from "./ui-lib";
import { useAllModels } from "../utils/hooks";
import { getModelProvider } from "../utils/model";
import { ModelSelector } from "./model-selector";
import { IconButton } from "./button";

export function ModelConfigList(props: {
  modelConfig: ModelConfig;
  updateConfig: (updater: (config: ModelConfig) => void) => void;
}) {
  const allModels = useAllModels();
  const availableModels = allModels.filter((v) => v.available);
  const [showModelSelector, setShowModelSelector] = useState(false);
  const [showCompressSelector, setShowCompressSelector] = useState(false);

  const groups = (() => {
    const map = new Map<string, typeof availableModels>();
    for (const m of availableModels) {
      const key = m?.provider?.providerName ?? "其他";
      if (!map.has(key)) map.set(key, []);
      map.get(key)!.push(m);
    }
    return Array.from(map.entries()).map(([provider, ms]) => ({
      provider,
      models: ms.map((m) => ({
        name: m.name,
        displayName: m.displayName,
        providerId: m.provider?.id,
      })),
    }));
  })();

  const value = `${props.modelConfig.model}@${props.modelConfig?.providerName}`;
  const compressValue = `${props.modelConfig.compressModel}@${props.modelConfig?.compressProviderName}`;
  const currentModelName =
    availableModels.find(
      (m) => `${m.name}@${m.provider?.providerName}` === value,
    )?.displayName ?? props.modelConfig.model;
  const currentCompressName =
    availableModels.find(
      (m) => `${m.name}@${m.provider?.providerName}` === compressValue,
    )?.displayName ||
    props.modelConfig.compressModel ||
    Locale.Settings.CompressModel.Title;

  return (
    <>
      <ListItem title={Locale.Settings.Model}>
        <IconButton
          bordered
          text={currentModelName}
          onClick={() => setShowModelSelector(true)}
        />
        {showModelSelector ? (
          <ModelSelector
            groups={groups}
            currentValue={value}
            onClose={() => setShowModelSelector(false)}
            onSelect={(s) => {
              const [withoutId, providerId] = s.split("|");
              const [model, providerName] = getModelProvider(withoutId);
              props.updateConfig((config) => {
                config.model = ModalConfigValidator.model(model);
                config.providerName = providerName as ServiceProvider;
                config.providerId = providerId ?? "";
              });
              setShowModelSelector(false);
            }}
          />
        ) : null}
      </ListItem>
      <ListItem
        title={Locale.Settings.Temperature.Title}
        subTitle={Locale.Settings.Temperature.SubTitle}
      >
        <InputRange
          aria={Locale.Settings.Temperature.Title}
          value={props.modelConfig.temperature?.toFixed(1)}
          min="0"
          max="1" // lets limit it to 0-1
          step="0.1"
          onChange={(e) => {
            props.updateConfig(
              (config) =>
                (config.temperature = ModalConfigValidator.temperature(
                  e.currentTarget.valueAsNumber,
                )),
            );
          }}
        ></InputRange>
      </ListItem>
      <ListItem
        title={Locale.Settings.TopP.Title}
        subTitle={Locale.Settings.TopP.SubTitle}
      >
        <InputRange
          aria={Locale.Settings.TopP.Title}
          value={(props.modelConfig.top_p ?? 1).toFixed(1)}
          min="0"
          max="1"
          step="0.1"
          onChange={(e) => {
            props.updateConfig(
              (config) =>
                (config.top_p = ModalConfigValidator.top_p(
                  e.currentTarget.valueAsNumber,
                )),
            );
          }}
        ></InputRange>
      </ListItem>
      <ListItem
        title={Locale.Settings.MaxTokens.Title}
        subTitle={Locale.Settings.MaxTokens.SubTitle}
      >
        <input
          aria-label={Locale.Settings.MaxTokens.Title}
          type="number"
          min={1024}
          max={512000}
          value={props.modelConfig.max_tokens}
          onChange={(e) =>
            props.updateConfig(
              (config) =>
                (config.max_tokens = ModalConfigValidator.max_tokens(
                  e.currentTarget.valueAsNumber,
                )),
            )
          }
        ></input>
      </ListItem>

      {props.modelConfig?.providerName == ServiceProvider.Google ? null : (
        <>
          <ListItem
            title={Locale.Settings.PresencePenalty.Title}
            subTitle={Locale.Settings.PresencePenalty.SubTitle}
          >
            <InputRange
              aria={Locale.Settings.PresencePenalty.Title}
              value={props.modelConfig.presence_penalty?.toFixed(1)}
              min="-2"
              max="2"
              step="0.1"
              onChange={(e) => {
                props.updateConfig(
                  (config) =>
                    (config.presence_penalty =
                      ModalConfigValidator.presence_penalty(
                        e.currentTarget.valueAsNumber,
                      )),
                );
              }}
            ></InputRange>
          </ListItem>

          <ListItem
            title={Locale.Settings.FrequencyPenalty.Title}
            subTitle={Locale.Settings.FrequencyPenalty.SubTitle}
          >
            <InputRange
              aria={Locale.Settings.FrequencyPenalty.Title}
              value={props.modelConfig.frequency_penalty?.toFixed(1)}
              min="-2"
              max="2"
              step="0.1"
              onChange={(e) => {
                props.updateConfig(
                  (config) =>
                    (config.frequency_penalty =
                      ModalConfigValidator.frequency_penalty(
                        e.currentTarget.valueAsNumber,
                      )),
                );
              }}
            ></InputRange>
          </ListItem>

          <ListItem
            title={Locale.Settings.InjectSystemPrompts.Title}
            subTitle={Locale.Settings.InjectSystemPrompts.SubTitle}
          >
            <input
              aria-label={Locale.Settings.InjectSystemPrompts.Title}
              type="checkbox"
              checked={props.modelConfig.enableInjectSystemPrompts}
              onChange={(e) =>
                props.updateConfig(
                  (config) =>
                    (config.enableInjectSystemPrompts =
                      e.currentTarget.checked),
                )
              }
            ></input>
          </ListItem>

          <ListItem
            title={Locale.Settings.InputTemplate.Title}
            subTitle={Locale.Settings.InputTemplate.SubTitle}
          >
            <input
              aria-label={Locale.Settings.InputTemplate.Title}
              type="text"
              value={props.modelConfig.template}
              onChange={(e) =>
                props.updateConfig(
                  (config) => (config.template = e.currentTarget.value),
                )
              }
            ></input>
          </ListItem>
        </>
      )}
      <ListItem
        title={Locale.Settings.HistoryCount.Title}
        subTitle={Locale.Settings.HistoryCount.SubTitle}
      >
        <InputRange
          aria={Locale.Settings.HistoryCount.Title}
          title={props.modelConfig.historyMessageCount.toString()}
          value={props.modelConfig.historyMessageCount}
          min="0"
          max="64"
          step="1"
          onChange={(e) =>
            props.updateConfig(
              (config) => (config.historyMessageCount = e.target.valueAsNumber),
            )
          }
        ></InputRange>
      </ListItem>

      <ListItem
        title={Locale.Settings.CompressThreshold.Title}
        subTitle={Locale.Settings.CompressThreshold.SubTitle}
      >
        <input
          aria-label={Locale.Settings.CompressThreshold.Title}
          type="number"
          min={500}
          max={4000}
          value={props.modelConfig.compressMessageLengthThreshold}
          onChange={(e) =>
            props.updateConfig(
              (config) =>
                (config.compressMessageLengthThreshold =
                  e.currentTarget.valueAsNumber),
            )
          }
        ></input>
      </ListItem>
      <ListItem title={Locale.Memory.Title} subTitle={Locale.Memory.Send}>
        <input
          aria-label={Locale.Memory.Title}
          type="checkbox"
          checked={props.modelConfig.sendMemory}
          onChange={(e) =>
            props.updateConfig(
              (config) => (config.sendMemory = e.currentTarget.checked),
            )
          }
        ></input>
      </ListItem>
      <ListItem
        title={Locale.Settings.CompressModel.Title}
        subTitle={Locale.Settings.CompressModel.SubTitle}
      >
        <IconButton
          bordered
          text={currentCompressName}
          onClick={() => setShowCompressSelector(true)}
        />
        {showCompressSelector ? (
          <ModelSelector
            groups={groups}
            currentValue={compressValue}
            onClose={() => setShowCompressSelector(false)}
            onSelect={(s) => {
              const [withoutId, providerId] = s.split("|");
              const [model, providerName] = getModelProvider(withoutId);
              props.updateConfig((config) => {
                config.compressModel = ModalConfigValidator.model(model);
                config.compressProviderName = providerName as ServiceProvider;
                config.compressProviderId = providerId ?? "";
              });
              setShowCompressSelector(false);
            }}
          />
        ) : null}
      </ListItem>
    </>
  );
}
