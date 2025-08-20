import React, { useEffect, useState } from "react";

const MainTabs = ({ tabs }) => {
  const [activeKey, setActiveKey] = useState(tabs[0]?.key || "");

  useEffect(() => {
    const current = tabs.find((t) => t.key === activeKey);
    if (!current || current.disabled) {
      const firstEnabled = tabs.find((t) => !t.disabled) ?? tabs[0];
      if (firstEnabled && firstEnabled.key !== activeKey) {
        setActiveKey(firstEnabled.key);
      }
    }
  }, [tabs, activeKey]);

  return (
    <div className="p-4">
      <div className="flex border-b border-gray-300">
        {tabs.map((tab) => {
          const isActive = activeKey === tab.key;
          const base =
            "px-4 py-2 text-sm font-semibold transition-colors duration-150";
          const activeCls = "border-b-2 border-blue-600 text-blue-600";
          const inactiveCls = "text-gray-600 hover:text-blue-600";
          const disabledCls = "text-gray-400 cursor-not-allowed opacity-60";

          return (
            <button
              key={tab.key}
              onClick={() => !tab.disabled && setActiveKey(tab.key)}
              disabled={!!tab.disabled}
              aria-disabled={!!tab.disabled}
              title={
                tab.disabled ? tab.disabledReason || "Disabled" : undefined
              }
              className={[
                base,
                isActive ? activeCls : inactiveCls,
                tab.disabled ? disabledCls : "",
              ].join(" ")}
            >
              {tab.label}
            </button>
          );
        })}
      </div>

      <div className="mt-4">
        {tabs.find((tab) => tab.key === activeKey)?.component}
      </div>
    </div>
  );
};

export default MainTabs;
