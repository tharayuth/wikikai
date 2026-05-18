import { configureStore } from "@reduxjs/toolkit";
import { setupListeners } from "@reduxjs/toolkit/query";
import { useDispatch, useSelector, type TypedUseSelectorHook } from "react-redux";
import { portalApi } from "./api";
import { uiSlice } from "./uiSlice";

export const store = configureStore({
  reducer: {
    [portalApi.reducerPath]: portalApi.reducer,
    ui: uiSlice.reducer,
  },
  middleware: (getDefault) => getDefault().concat(portalApi.middleware),
});

setupListeners(store.dispatch);

export type RootState = ReturnType<typeof store.getState>;
export type AppDispatch = typeof store.dispatch;

export const useAppDispatch = () => useDispatch<AppDispatch>();
export const useAppSelector: TypedUseSelectorHook<RootState> = useSelector;
