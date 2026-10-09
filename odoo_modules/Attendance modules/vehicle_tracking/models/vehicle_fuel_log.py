# -*- coding: utf-8 -*-
from odoo import api, fields, models

class VehicleFuelLog(models.Model):
    _name = 'vehicle.fuel.log'
    _description = 'Vehicle Fuel Log'
    _order = 'create_date desc'

    # Primary Key
    name = fields.Char(string="Ref", default="New", readonly=True)

    # Foreign Keys

    vehicle_id = fields.Many2one(
        'fleet.vehicle',
        string='Vehicle',
        required=True
    )

    vehicle_tracking_id = fields.Many2one(
        'vehicle.tracking',
        string='Vehicle Tracking',
        required=True
    )

    driver_id = fields.Many2one(
        'res.partner',
        string='Driver',
        domain="[('is_company','=',False)]",
        required=True
    )

    # Fuel & Amount
    amount = fields.Float(string='Amount (OMR)', required=True)
    fuel_level = fields.Float(string='Fuel Level (Litres)', required=True)
    odometer = fields.Float(string='Odometer Reading', help="Reading at fuel stop")

    # Images — odometer photo (existing) + fuel receipt (new).
    # `upload_path` is kept on the model for backward-compat with legacy rows
    # but is removed from the form view (it used to print raw base64).
    upload_path = fields.Char(string='Upload Path (legacy)')
    odometer_image = fields.Image(string='Odometer Image')
    odometer_image_filename = fields.Char(string="Odometer Filename")
    receipt_image = fields.Image(string='Fuel Receipt')
    receipt_image_filename = fields.Char(string='Receipt Filename')

    # GPS Tracking
    gps_lat = fields.Char(string='GPS Latitude')
    gps_long = fields.Char(string='GPS Longitude')

    # Auto timestamp
    create_date = fields.Datetime(
        string='Created Date',
        default=fields.Datetime.now,
        readonly=True
    )

    @api.onchange('vehicle_tracking_id')
    def _onchange_vehicle_tracking_id(self):
        """Pre-fill vehicle + driver from the trip (driver falls back to the
        vehicle's assigned driver when the trip has none)."""
        trip = self.vehicle_tracking_id
        if not trip:
            return
        if not self.vehicle_id and trip.vehicle_id:
            self.vehicle_id = trip.vehicle_id
        if not self.driver_id:
            self.driver_id = trip.driver_id or self.vehicle_id.driver_id

    def _fill_from_trip(self, vals):
        """Fill missing vehicle_id / driver_id from the linked trip so a fuel
        log can be added to a trip that was saved without a driver (vehicle
        and driver are optional on vehicle.tracking but required here).
        Driver falls back to the vehicle's assigned driver."""
        if vals.get('vehicle_id') and vals.get('driver_id'):
            return
        trip = self.env['vehicle.tracking'].browse(vals.get('vehicle_tracking_id') or [])
        trip = trip.exists()
        if not vals.get('vehicle_id') and trip.vehicle_id:
            vals['vehicle_id'] = trip.vehicle_id.id
        if not vals.get('driver_id'):
            vehicle = self.env['fleet.vehicle'].browse(vals.get('vehicle_id') or []).exists()
            driver = trip.driver_id or vehicle.driver_id
            if driver:
                vals['driver_id'] = driver.id

    @api.model_create_multi
    def create(self, vals_list):
        """Auto sequence for reference + auto-set image filenames."""
        for vals in vals_list:
            self._fill_from_trip(vals)
            if vals.get('name', 'New') == 'New':
                vals['name'] = self.env['ir.sequence'].next_by_code('vehicle.fuel.log') or 'New'
            if vals.get('odometer_image') and not vals.get('odometer_image_filename'):
                vals['odometer_image_filename'] = 'odometer.jpg'
            if vals.get('receipt_image') and not vals.get('receipt_image_filename'):
                vals['receipt_image_filename'] = 'receipt.jpg'
        return super(VehicleFuelLog, self).create(vals_list)

    def action_save_fuel_log(self):
        """Close the popup after saving"""
        return {'type': 'ir.actions.act_window_close'}