import React, { useState } from "react";

const MainTabs = ({ tabs }) => {
  const [activeKey, setActiveKey] = useState(tabs[0]?.key || "");

  return (
    <div className="p-4">
      <div className="flex border-b border-gray-300">
        {tabs.map((tab) => (
          <button
            key={tab.key}
            onClick={() => setActiveKey(tab.key)}
            className={`px-4 py-2 text-sm font-semibold ${
              activeKey === tab.key
                ? "border-b-2 border-blue-600 text-blue-600"
                : "text-gray-600 hover:text-blue-600"
            }`}
          >
            {tab.label}
          </button>
        ))}
      </div>
      <div className="mt-4">
        {tabs.find((tab) => tab.key === activeKey)?.component}
      </div>
    </div>
  );
};

export default MainTabs;
