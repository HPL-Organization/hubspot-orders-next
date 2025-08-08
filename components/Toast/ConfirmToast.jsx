// Components/Toast/ConfirmToast.jsx
import { toast } from "react-toastify";
import "react-toastify/dist/ReactToastify.css";

export const confirmToast = (message) => {
  return new Promise((resolve) => {
    const toastId = toast(
      ({ closeToast }) => (
        <div>
          <div className="font-semibold mb-2">{message}</div>
          <div className="flex gap-2">
            <button
              onClick={() => {
                toast.dismiss(toastId);
                resolve(true);
              }}
              className="px-3 py-1 text-white bg-green-600 rounded hover:bg-green-700"
            >
              Yes
            </button>
            <button
              onClick={() => {
                toast.dismiss(toastId);
                resolve(false);
              }}
              className="px-3 py-1 text-white bg-gray-600 rounded hover:bg-gray-700"
            >
              No
            </button>
          </div>
        </div>
      ),
      {
        autoClose: false,
        closeOnClick: false,
        draggable: false,
      }
    );
  });
};
