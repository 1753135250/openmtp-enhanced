package mtp

import (
	"fmt"
	"github.com/ganeshrvel/usb"
)

type DeviceChoice struct {
	Key       string `json:"key"`
	Label     string `json:"label"`
	Serial    string `json:"serial"`
	VendorID  uint16 `json:"vendorId"`
	ProductID uint16 `json:"productId"`
}

func deviceKey(d *Device) string {
	return fmt.Sprintf("%03d:%03d", d.dev.GetBusNumber(), d.dev.GetDeviceAddress())
}
func ListDeviceChoices() ([]DeviceChoice, error) {
	c := usb.NewContext()
	defer c.Exit()
	devices, err := FindDevices(c)
	if err != nil {
		return nil, err
	}
	choices := make([]DeviceChoice, 0, len(devices))
	for _, d := range devices {
		key := deviceKey(d)
		choice := DeviceChoice{Key: key, Label: fmt.Sprintf("MTP %04x:%04x", d.devDescr.IdVendor, d.devDescr.IdProduct), VendorID: d.devDescr.IdVendor, ProductID: d.devDescr.IdProduct}
		if err := d.Open(); err == nil {
			if info, err := d.GetUsbInfo(); err == nil {
				choice.Serial = info.SerialNumber
				choice.Label = info.Manufacturer + " " + info.Product + " " + info.SerialNumber
			}
			d.Close()
		}
		choice.Label += " (USB " + key + ")"
		choices = append(choices, choice)
		d.Done()
	}
	return choices, nil
}
func SelectDeviceByKey(key string) (*Device, error) {
	c := usb.NewContext()
	devices, err := FindDevices(c)
	if err != nil {
		c.Exit()
		return nil, err
	}
	var chosen *Device
	for _, d := range devices {
		if deviceKey(d) == key && chosen == nil {
			chosen = d
		} else {
			d.Done()
		}
	}
	if chosen == nil {
		c.Exit()
		return nil, fmt.Errorf("selected device disconnected; choose a connected device")
	}
	d, err := selectDevice([]*Device{chosen}, "")
	if err != nil {
		chosen.Close()
		chosen.Done()
		c.Exit()
		return nil, err
	}
	d.ownedContext = c
	return d, nil
}
