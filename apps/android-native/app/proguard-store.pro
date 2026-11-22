# The store build drops info, debug and verbose log lines (ids, test notes); warnings and errors stay.
-assumenosideeffects class android.util.Log {
    public static int i(...);
    public static int d(...);
    public static int v(...);
}
