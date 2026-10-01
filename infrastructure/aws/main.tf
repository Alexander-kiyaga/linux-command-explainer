terraform {
  required_version = ">= 1.5.0"
  required_providers {
    aws = {
      source  = "hashicorp/aws"
      version = "~> 6.0"
    }
  }
}

provider "aws" {
  region = var.aws_region
}

variable "aws_region" {
  description = "AWS region for the LinuxLab instance."
  type        = string
}

variable "vpc_id" {
  description = "Existing VPC containing the public subnet."
  type        = string
  validation {
    condition     = can(regex("^vpc-[0-9a-f]+$", var.vpc_id))
    error_message = "vpc_id must be an AWS VPC ID."
  }
}

variable "subnet_id" {
  description = "Existing public subnet with an Internet Gateway route."
  type        = string
  validation {
    condition     = can(regex("^subnet-[0-9a-f]+$", var.subnet_id))
    error_message = "subnet_id must be an AWS subnet ID."
  }
}

variable "ec2_key_name" {
  description = "Existing EC2 key-pair name; private key stays with the administrator."
  type        = string
  validation {
    condition     = length(trimspace(var.ec2_key_name)) > 0
    error_message = "ec2_key_name cannot be empty."
  }
}

variable "admin_ssh_cidr" {
  description = "Single administrator IPv4 CIDR, preferably /32. Never use 0.0.0.0/0."
  type        = string
  validation {
    condition     = can(cidrnetmask(var.admin_ssh_cidr)) && endswith(var.admin_ssh_cidr, "/32")
    error_message = "admin_ssh_cidr must be one administrator IPv4 address with /32."
  }
}

variable "instance_type" {
  description = "Small portfolio instance size."
  type        = string
  default     = "t3.micro"
}

data "aws_ssm_parameter" "amazon_linux" {
  name = "/aws/service/ami-amazon-linux-latest/al2023-ami-kernel-default-x86_64"
}

resource "aws_security_group" "web" {
  name_prefix = "linux-explainer-"
  description = "Linux Command Explainer HTTP and SSH"
  vpc_id      = var.vpc_id

  ingress {
    description = "Administrator SSH"
    from_port   = 22
    to_port     = 22
    protocol    = "tcp"
    cidr_blocks = [var.admin_ssh_cidr]
  }

  ingress {
    description = "Public HTTP assignment site"
    from_port   = 80
    to_port     = 80
    protocol    = "tcp"
    cidr_blocks = ["0.0.0.0/0"]
  }

  egress {
    from_port   = 0
    to_port     = 0
    protocol    = "-1"
    cidr_blocks = ["0.0.0.0/0"]
  }

  tags = { Name = "linux-command-explainer" }
}

resource "aws_instance" "web" {
  ami                         = data.aws_ssm_parameter.amazon_linux.value
  instance_type               = var.instance_type
  subnet_id                   = var.subnet_id
  key_name                    = var.ec2_key_name
  associate_public_ip_address = true
  vpc_security_group_ids      = [aws_security_group.web.id]

  user_data                   = <<-SCRIPT
    #!/bin/bash
    set -euo pipefail
    dnf install -y python3.12 python3.12-pip
  SCRIPT
  user_data_replace_on_change = true

  root_block_device {
    volume_size           = 12
    volume_type           = "gp3"
    encrypted             = true
    delete_on_termination = true
  }

  metadata_options {
    http_endpoint = "enabled"
    http_tokens   = "required"
  }

  tags = { Name = "linux-command-explainer" }
}

output "public_ip" {
  description = "Use as the Ansible inventory address; it may change after EC2 stop/start."
  value       = aws_instance.web.public_ip
}
