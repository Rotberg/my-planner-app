import React from 'react';
import { Pressable, Text } from 'react-native';
import { useTheme } from '../../utils/theme';

type Props = {
  label: string;
  selected: boolean;
  onPress: () => void;
  /** Fill colour when selected. Defaults to the app's teal. */
  color?: string;
  disabled?: boolean;
  /** Share the row's width equally with sibling chips. */
  fill?: boolean;
};

/** Selectable pill used for choices in the Money forms. */
export default function Chip({ label, selected, onPress, color = '#0d9488', disabled, fill }: Props) {
  const theme = useTheme();
  return (
    <Pressable
      className={`${fill ? 'flex-1 ' : ''}rounded-lg border-[1.5px] px-3 py-2 items-center`}
      style={[
        selected ? { backgroundColor: color, borderColor: color } : { borderColor: theme.border },
        disabled ? { opacity: 0.4 } : null,
      ]}
      disabled={disabled}
      onPress={onPress}
      accessibilityRole="button"
      accessibilityState={{ selected, disabled }}
    >
      <Text className={`text-[12px] font-semibold ${selected ? 'text-white' : 'text-stone-500 dark:text-stone-400'}`}>
        {label}
      </Text>
    </Pressable>
  );
}
